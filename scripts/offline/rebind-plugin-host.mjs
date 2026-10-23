// Embedded in the main installer so existing archives need no extra helper file.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const check = (ok, text) => { if (!ok) throw new Error(text); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const validName = name => typeof name === 'string' && /^(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+$/.test(name)
  && !name.includes('..') && !['__proto__', 'constructor', 'prototype'].includes(name);
const validProfile = name => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) && !name.includes('..');
const isDsh = name => name.startsWith('@deepseek-ai/dsh-');
const legacyBrowserPeers = ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react-dom'];
function packageDir(name, anchor) {
  check(validName(name), 'Invalid peer name');
  for (const dir of createRequire(anchor).resolve.paths(name) ?? []) {
    const target = path.join(dir, name);
    if (fs.existsSync(path.join(target, 'package.json'))) return fs.realpathSync(target);
  }
  throw new Error(`New DSH does not provide ${name}`);
}
function atomicText(file, text) {
  const tmp = `${file}.rebind-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
function atomicLink(file, target) {
  const tmp = `${file}.rebind-${process.pid}`;
  fs.symlinkSync(target, tmp);
  try { fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
export function rebindPluginHost(runtime, home) {
  const base = path.join(path.resolve(home), 'offline-plugins');
  if (!fs.existsSync(base)) return;
  const receipts = [];
  const addReceipts = (dir, profile) => {
    for (const entry of fs.readdirSync(dir).sort()) {
      if (entry.endsWith('.receipt.json')) receipts.push({ file: path.join(dir, entry), profile });
    }
  };
  addReceipts(base, 'web');
  const extra = path.join(base, '.receipts');
  if (fs.existsSync(extra)) {
    for (const profile of fs.readdirSync(extra).sort()) {
      check(validProfile(profile), 'Invalid offline plugin profile');
      addReceipts(path.join(extra, profile), profile);
    }
  }
  if (!receipts.length) return;
  const lock = path.join(base, '.install-lock');
  fs.mkdirSync(lock);
  try {
    runtime = fs.realpathSync(runtime);
    const app = path.join(runtime, 'app/package.json');
    const version = read(app).version, semver = createRequire(app)('semver');
    const minimum = (actual, range, label) => {
      const value = semver.minVersion(range);
      check(value && semver.valid(actual) && semver.gte(actual, value), `${label} requires at least ${value?.version ?? range}; found ${actual}`);
    };
    const links = new Map(), updates = [];
    let managed = 0;
    // Validate every plugin before changing any dependency link.
    for (const { file, profile } of receipts) {
      const original = fs.readFileSync(file, 'utf8'), receipt = JSON.parse(original);
      const name = decodeURIComponent(path.basename(file, '.receipt.json'));
      check(validName(name), 'Invalid offline plugin identity');
      const profileRoot = path.join(path.resolve(home), 'profiles', profile);
      const manifestFile = path.join(profileRoot, 'package.json');
      if (!fs.existsSync(manifestFile)) continue;
      const manifest = read(manifestFile);
      if (!manifest.dsh?.profile?.bundles?.includes(name)) continue;
      check(manifest.dependencies?.[name] === `link:${receipt.target}`, `Plugin registration changed: ${name}`);
      const publicLink = path.join(profileRoot, 'node_modules', name);
      check(fs.lstatSync(publicLink).isSymbolicLink() && fs.readlinkSync(publicLink) === receipt.target, `Plugin link changed: ${name}`);
      const target = fs.realpathSync(receipt.target), realBase = fs.realpathSync(base);
      check(target.startsWith(realBase + path.sep), `Plugin is outside managed storage: ${name}`);
      const meta = read(path.join(target, 'package.json'));
      check(meta.name === name, 'Plugin identity mismatch');
      const requirements = receipt.hostRequirements ?? meta.peerDependencies ?? {};
      const browsers = new Set(receipt.browserPeers ?? legacyBrowserPeers);
      const dshPeers = Object.entries({ ...requirements, ...meta.peerDependencies }).filter(([peer]) => isDsh(peer));
      if (meta.engines?.dsh) minimum(version, meta.engines.dsh, `${name}: DSH`);
      for (const [peer, range] of dshPeers) minimum(version, range, `${name}: ${peer}`);
      const fallback = receipt.minDshVersion ?? receipt.buildDshVersion ?? receipt.runtimeVersion;
      if (!meta.engines?.dsh && !dshPeers.length && fallback) minimum(version, fallback, `${name}: DSH`);
      const modules = path.resolve(target, ...name.split('/').map(() => '..'));
      for (const [peer, range] of Object.entries(requirements)) {
        check(validName(peer), 'Invalid host dependency');
        if (browsers.has(peer)) continue;
        const slot = path.join(modules, peer);
        check(fs.lstatSync(slot).isSymbolicLink(), `Host dependency is not a managed link: ${name}: ${peer}`);
        const next = packageDir(peer, app), peerVersion = read(path.join(next, 'package.json')).version;
        if (isDsh(peer)) minimum(peerVersion, range, `${name}: ${peer}`);
        else check(semver.satisfies(peerVersion, range, { includePrerelease: true }), `${name}: ${peer}@${peerVersion} does not satisfy ${range}`);
        const previous = fs.readlinkSync(slot);
        if (path.resolve(path.dirname(slot), previous) !== next) links.set(slot, { file: slot, previous, next });
      }
      if (receipt.runtime !== runtime || receipt.runtimeVersion !== version) {
        updates.push({ file, previous: original, next: JSON.stringify({ ...receipt, runtime, runtimeVersion: version }, null, 2) + '\n' });
      }
      managed++;
    }
    const journal = [];
    try {
      for (const entry of links.values()) { atomicLink(entry.file, entry.next); journal.push({ ...entry, link: true }); }
      for (const entry of updates) { atomicText(entry.file, entry.next); journal.push(entry); }
    } catch (error) {
      for (const entry of journal.reverse()) {
        if (entry.link) atomicLink(entry.file, entry.previous); else atomicText(entry.file, entry.previous);
      }
      throw error;
    }
    console.log(`install-and-run: 已识别 ${managed} 个离线插件，更新 ${links.size} 个宿主依赖链接，沿用原配置与数据`);
  } finally { fs.rmdirSync(lock); }
}
if (process.argv[1] === '-' || (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)) {
  try { rebindPluginHost(...process.argv.slice(2)); }
  catch (error) { console.error(`install-and-run: 自动更新插件依赖失败：${error.message}`); process.exitCode = 1; }
}
