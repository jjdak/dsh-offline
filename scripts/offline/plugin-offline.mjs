// Generic installer for reviewed offline plugin bundles. No package manager or network.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validName = n => typeof n === 'string' && /^(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+$/.test(n)
  && !n.includes('..') && !['__proto__', 'constructor', 'prototype'].includes(n);
const validVersion = v => typeof v === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
const validProfile = n => typeof n === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(n) && !n.includes('..');
const legacyBrowserPeers = ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react-dom'];
function packageDir(name, anchor) {
  check(validName(name), 'Invalid package name');
  const req = createRequire(anchor);
  for (const parent of req.resolve.paths(name) ?? []) {
    const dir = path.join(parent, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) return fs.realpathSync(dir);
  }
  throw new Error(`Missing dependency: ${name}`);
}
function safeRelative(p) {
  return typeof p === 'string' && p.length > 0 && !p.includes('\\') && !p.includes('\0')
    && p.split('/').every(s => s && s !== '.' && s !== '..') && !path.isAbsolute(p);
}
function loadBundle(file) {
  const bytes = fs.readFileSync(file);
  const expected = fs.readFileSync(`${file}.sha256`, 'utf8').trim().split(/\s+/)[0];
  check(/^[a-f0-9]{64}$/.test(expected) && hash(bytes) === expected, 'Bundle SHA-256 mismatch');
  const b = JSON.parse(gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }));
  check(record(b) && [1, 2].includes(b.format), 'Unsupported bundle format');
  check(validName(b.name) && validVersion(b.version) && validVersion(b.dshVersion), 'Invalid plugin/runtime identity');
  check(b.platform === process.platform && b.arch === process.arch, 'Wrong target platform');
  // v1 bundles predate explicit profile/browser metadata; retain their Web defaults.
  b.profile ??= 'web';
  b.browserPeers ??= b.format === 1 ? legacyBrowserPeers : [];
  check(validProfile(b.profile), 'Invalid target profile');
  check(Array.isArray(b.browserPeers) && b.browserPeers.every(validName), 'Invalid browser peer list');
  check(record(b.packages) && Object.entries(b.packages).every(([n, v]) => validName(n) && validVersion(v)), 'Invalid package inventory');
  check(b.packages[b.name] === b.version, 'Root package is missing from inventory');
  check(record(b.peers) && Object.entries(b.peers).every(([n, r]) => validName(n) && typeof r === 'string'), 'Invalid host peer inventory');
  check(Array.isArray(b.files) && b.files.length > 0, 'Missing payload files');
  const seen = new Set();
  for (const f of b.files) {
    check(record(f) && safeRelative(f.path) && f.path.startsWith('node_modules/') && !seen.has(f.path), 'Unsafe or duplicate payload path');
    const parts = f.path.split('/'), name = parts[1].startsWith('@') ? `${parts[1]}/${parts[2]}` : parts[1];
    check(Object.hasOwn(b.packages, name), 'Payload package not in inventory');
    seen.add(f.path);
    check(f.mode === 0o644 || f.mode === 0o755, 'Invalid file mode');
    check(typeof f.data === 'string', 'Invalid payload data');
    check(!f.path.split('/').some(n => /^\.env(?:\.|$)/.test(n) || n === '.npmrc' || /\.(pem|key|env)$/.test(n)), 'Sensitive payload filename');
  }
  for (const [name, version] of Object.entries(b.packages)) {
    const f = b.files.find(f => f.path === `node_modules/${name}/package.json`);
    check(f, `Missing manifest: ${name}`);
    const meta = JSON.parse(Buffer.from(f.data, 'base64'));
    check(meta.name === name && meta.version === version, `Payload identity mismatch: ${name}`);
    if (name === b.name) check(meta.dsh?.bundle?.patch, 'Root package must declare a DSH bundle patch');
  }
  return { b, digest: expected };
}
function atomic(p, data) {
  const tmp = `${p}.offline-${process.pid}`;
  fs.writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, p);
}
const isDshPeer = name => name.startsWith('@deepseek-ai/dsh-');
function requireMinimum(semver, actual, range, label) {
  const minimum = semver.minVersion(range);
  check(minimum && semver.valid(actual), `Invalid version requirement: ${label} ${range}`);
  check(semver.gte(actual, minimum), `${label} requires >=${minimum.version}; found ${actual}`);
}
function unregister(manifest, name, original) {
  const next = structuredClone(manifest);
  delete next.dependencies[name];
  if (!Object.keys(next.dependencies).length && !Object.hasOwn(original, 'dependencies')) delete next.dependencies;
  next.dsh.profile.bundles = next.dsh.profile.bundles.filter(n => n !== name);
  return next;
}
function install(command, file, runtime, home, stopped, profileOverride) {
  check(stopped === '--stopped', 'Stop ALL DSH processes using this data directory, then append --stopped');
  check(runtime && home, 'runtime and data directory required');
  runtime = fs.realpathSync(runtime); home = fs.realpathSync(home);
  const { b, digest } = loadBundle(file);
  const profileName = profileOverride || b.profile;
  check(validProfile(profileName), 'Invalid target profile');
  const browserPeers = new Set(b.browserPeers);
  const app = path.join(runtime, 'app/package.json');
  const runtimeVersion = read(app).version;
  const semver = createRequire(app)('semver');
  const root = JSON.parse(Buffer.from(b.files.find(f => f.path === `node_modules/${b.name}/package.json`).data, 'base64'));
  const dshRequirements = Object.entries({ ...b.peers, ...root.peerDependencies }).filter(([name]) => isDshPeer(name));
  if (root.engines?.dsh) requireMinimum(semver, runtimeVersion, root.engines.dsh, 'DSH');
  for (const [name, range] of dshRequirements) requireMinimum(semver, runtimeVersion, range, `DSH (${name})`);
  // dshVersion records the build/test host. Only bundles without declared DSH
  // requirements use it as a fallback minimum; it is never an equality check.
  if (!root.engines?.dsh && !dshRequirements.length) requireMinimum(semver, runtimeVersion, b.minDshVersion ?? b.dshVersion, 'DSH');
  const profile = path.join(home, 'profiles', profileName), manifest = path.join(profile, 'package.json');
  check(fs.existsSync(manifest), `Initialize profile ${profileName}, then stop DSH before installing`);
  const base = path.join(home, 'offline-plugins'); fs.mkdirSync(base, { recursive: true });
  const lock = path.join(base, '.install-lock'); fs.mkdirSync(lock);
  try {
    const slug = encodeURIComponent(b.name);
    const receiptDir = profileName === 'web' ? base : path.join(base, '.receipts', profileName);
    fs.mkdirSync(receiptDir, { recursive: true });
    const receipt = path.join(receiptDir, `${slug}.receipt.json`);
    const link = path.join(profile, 'node_modules', b.name);
    const current = fs.readFileSync(manifest, 'utf8');
    if (command === 'rollback') {
      const r = read(receipt);
      check(r.digest === digest, 'Rollback bundle differs from installed revision');
      check(fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === r.target, 'Plugin link changed; refusing rollback');
      const next = JSON.parse(current);
      check(next.dependencies?.[b.name] === `link:${r.target}` && next.dsh?.profile?.bundles?.filter(n => n === b.name).length === 1,
        'Plugin registration changed; refusing rollback');
      const restored = hash(current) === r.afterHash ? r.before : JSON.stringify(unregister(next, b.name, JSON.parse(r.before)), null, 2) + '\n';
      fs.unlinkSync(link);
      if (r.previousLink !== null) fs.symlinkSync(r.previousLink, link);
      atomic(manifest, restored);
      fs.renameSync(receipt, `${receipt}.rolled-back-${Date.now()}`);
      console.log('Rolled back registration; plugin files retained for recovery. Restart DSH.');
      return;
    }
    check(command === 'install', 'Unknown command');
    const hostPeers = new Map();
    for (const [name, range] of Object.entries(b.peers)) {
      if (browserPeers.has(name)) continue;
      check(!b.packages[name], `Peer overlaps bundled dependency: ${name}`);
      const peer = packageDir(name, app), p = read(path.join(peer, 'package.json'));
      if (isDshPeer(name)) requireMinimum(semver, p.version, range, name);
      else check(semver.satisfies(p.version, range, { includePrerelease: true }), `Host peer mismatch: ${name}@${p.version} needs ${range}`);
      hostPeers.set(name, peer);
    }
    const targetRoot = path.join(base, `${slug}-${b.version}-${digest.slice(0, 16)}-host-${hash(`${runtime}\0${runtimeVersion}`).slice(0, 12)}`);
    const target = path.join(targetRoot, 'node_modules', b.name);
    let priorReceipt = null;
    if (fs.existsSync(receipt)) {
      const r = read(receipt);
      check(r.digest === digest, 'Another plugin revision is registered; rollback it first');
      check(fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === r.target, 'Plugin link changed');
      const active = JSON.parse(current);
      check(active.dependencies?.[b.name] === `link:${r.target}` && active.dsh?.profile?.bundles?.filter(n => n === b.name).length === 1, 'Plugin registration changed');
      const oldModules = path.resolve(r.target, ...b.name.split('/').map(() => '..'));
      const samePeers = [...hostPeers].every(([name, peer]) => {
        try { return fs.realpathSync(path.join(oldModules, name)) === peer; } catch { return false; }
      });
      if ((r.target === target || (r.runtime === runtime && r.runtimeVersion === runtimeVersion)) && samePeers) {
        console.log('Already installed; no configuration changed.'); return;
      }
      priorReceipt = r;
    }
    const before = JSON.parse(current);
    check(Array.isArray(before.dsh?.profile?.bundles), 'Missing profile bundle list');
    let previousLink = null;
    try {
      check(fs.lstatSync(link).isSymbolicLink(), 'Existing plugin is not a symlink; refusing to replace it');
      previousLink = fs.readlinkSync(link);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    check(priorReceipt || (!before.dependencies?.[b.name] && !before.dsh.profile.bundles.includes(b.name)), 'Existing plugin registration must be managed separately');
    const staging = fs.mkdtempSync(path.join(base, '.stage-'));
    try {
      for (const f of b.files) {
        const dest = path.join(staging, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(f.data, 'base64'), { flag: 'wx', mode: f.mode });
      }
      for (const [name, peer] of hostPeers) {
        const dest = path.join(staging, 'node_modules', name);
        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.symlinkSync(peer, dest);
      }
      if (fs.existsSync(targetRoot)) {
        // Rollback keeps payloads. Reuse only byte-identical files and the same host peers.
        for (const f of b.files) {
          const p = path.join(targetRoot, f.path);
          check(fs.lstatSync(p).isFile() && fs.readFileSync(p).equals(Buffer.from(f.data, 'base64')), `Retained payload changed: ${f.path}`);
        }
        for (const [name, peer] of hostPeers) {
          check(fs.realpathSync(path.join(targetRoot, 'node_modules', name)) === peer, 'Retained host peer changed');
        }
      } else fs.renameSync(staging, targetRoot);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    const next = structuredClone(before);
    next.dependencies ??= {}; next.dependencies[b.name] = `link:${target}`;
    if (!priorReceipt) next.dsh.profile.bundles.push(b.name);
    const after = JSON.stringify(next, null, 2) + '\n';
    const rollbackBefore = !priorReceipt ? current : hash(current) === priorReceipt.afterHash ? priorReceipt.before
      : JSON.stringify(unregister(before, b.name, JSON.parse(priorReceipt.before)), null, 2) + '\n';
    const r = { digest, before: rollbackBefore, afterHash: hash(after), previousLink: priorReceipt ? priorReceipt.previousLink : previousLink,
      target, runtime, runtimeVersion, hostRequirements: b.peers, browserPeers: b.browserPeers,
      minDshVersion: b.minDshVersion, buildDshVersion: b.dshVersion };
    // Receipt precedes activation so interrupted writes can be inspected and recovered.
    write(receipt, r);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try {
      if (previousLink !== null) fs.unlinkSync(link);
      fs.symlinkSync(target, link);
      atomic(manifest, after);
    } catch (e) {
      if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === target) fs.unlinkSync(link);
      if (previousLink !== null) fs.symlinkSync(previousLink, link);
      atomic(manifest, current);
      if (priorReceipt) write(receipt, priorReceipt); else fs.unlinkSync(receipt);
      throw e;
    }
    console.log(`Installed ${b.name}@${b.version} into ${profile}. Restart DSH.`);
    if (priorReceipt) console.log(`Rebound plugin host dependencies to DSH ${runtimeVersion}.`);
    if (typeof b.installNotes === 'string') console.log(b.installNotes);
  } finally { fs.rmdirSync(lock); }
}
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build') await (await import('./build-plugin-offline.mjs')).build(...args);
  else if (command === 'install' || command === 'rollback') install(command, ...args);
  else { console.log('build SOURCE OUTPUT | install/rollback BUNDLE RUNTIME DSH_HOME --stopped [PROFILE]'); process.exitCode = command === '--help' ? 0 : 2; }
} catch (e) { console.error(`plugin-offline: ${e.message}`); process.exitCode = 1; }
