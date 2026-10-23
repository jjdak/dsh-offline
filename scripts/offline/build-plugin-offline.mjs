// Build-time recipes; the target installer never executes these adaptations.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
const validName = n => typeof n === 'string' && /^(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+$/.test(n) && !n.includes('..');
// These peers are supplied by the prebuilt Web module registry, not Node packages.
const browserPeers = new Set(['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react-dom']);
function packageDir(name, anchor) {
  check(validName(name), 'Invalid package name');
  const req = createRequire(anchor);
  for (const parent of req.resolve.paths(name) ?? []) {
    const dir = path.join(parent, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) return fs.realpathSync(dir);
  }
  throw new Error(`Missing dependency: ${name}`);
}
function collect(dir, prefix, output) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (['node_modules', '.git', '.DS_Store'].includes(name)) continue;
    check(!/^\.env(?:\.|$)/.test(name) && !/\.(env|pem|key)$/.test(name) && name !== '.npmrc', `Sensitive filename: ${name}`);
    const full = path.join(dir, name), rel = `${prefix}/${name}`, stat = fs.lstatSync(full);
    check(!stat.isSymbolicLink(), `Unexpected symlink: ${full}`);
    if (stat.isDirectory()) collect(full, rel, output);
    else {
      check(stat.isFile(), `Not a regular file: ${full}`);
      const bytes = fs.readFileSync(full);
      check(!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])), `Native ELF needs separate review: ${full}`);
      check(!/\.(node|so|exe|dll|dylib)$/.test(name), `Native file needs separate review: ${full}`);
      output.push({ path: rel, mode: stat.mode & 0o111 ? 0o755 : 0o644, data: bytes.toString('base64') });
    }
  }
}
export async function build(source, destination, pythonRoot) {
  check(source && destination, 'build requires installed plugin directory and output file');
  source = fs.realpathSync(source);
  const root = read(path.join(source, 'package.json'));
  if (root.name === '@furongjun1999/dsh-memory') {
    return (await import('./build-memory-offline.mjs')).build(source, destination, pythonRoot);
  }
  check(root.name === 'dsh-pet' && root.version === '0.3.7', 'Only reviewed dsh-pet 0.3.7 recipe is supported');
  const files = [], packages = {}, peers = {}, queue = [source];
  while (queue.length) {
    const dir = queue.shift(), pkg = read(path.join(dir, 'package.json'));
    check(validName(pkg.name), 'Invalid dependency name');
    if (packages[pkg.name]) {
      check(packages[pkg.name] === pkg.version, `Multiple versions need a new recipe: ${pkg.name}`);
      continue;
    }
    check(!Object.keys(pkg.optionalDependencies ?? {}).length, `Optional dependencies need review: ${pkg.name}`);
    packages[pkg.name] = pkg.version;
    Object.assign(peers, pkg.peerDependencies ?? {});
    collect(dir, `node_modules/${pkg.name}`, files);
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      // The reviewed browser-only recipe removes both Electron download/extract paths below.
      if (pkg.name === 'dsh-pet' && ['@electron/get', '@electron-internal/extract-zip'].includes(name)) continue;
      queue.push(packageDir(name, path.join(dir, 'package.json')));
    }
  }
  const config = files.find(f => f.path === 'node_modules/dsh-pet/assets/config.jsonc');
  check(config, 'Missing default pet config');
  let value = Buffer.from(config.data, 'base64').toString('utf8');
  value = value.replace(/"display"\s*:\s*"both"/g, '"display": "web"')
    .replace(/"balanceEnabled"\s*:\s*true/g, '"balanceEnabled": false')
    .replace(/"whisperEnabled"\s*:\s*true/g, '"whisperEnabled": false');
  config.data = Buffer.from(value).toString('base64');
  const host = files.find(f => f.path === 'node_modules/dsh-pet/lib/index.js');
  let code = Buffer.from(host.data, 'base64').toString('utf8');
  for (const marker of ['import { downloadArtifact } from "@electron/get";', 'async function ensureElectronDownload(options = {}) {', '\nfunction defaultLaunch(', '\tconst startHelper = () => {', '\n\t/** 停止桌面 Helper']) {
    check(code.split(marker).length === 2, `Desktop patch input changed: ${marker}`);
  }
  code = code.replace('import { downloadArtifact } from "@electron/get";', '')
    .replace(/async function ensureElectronDownload\(options = \{\}\) \{[\s\S]*?\nfunction defaultLaunch\(/,
      'async function ensureElectronDownload() { throw new Error("Desktop mode disabled in offline web-only build"); }\nfunction defaultLaunch(')
    .replace(/\tconst startHelper = \(\) => \{[\s\S]*?\n\t\/\*\* 停止桌面 Helper/,
      '\tconst startHelper = () => {}; // offline: never launch or download Electron\n\t/** 停止桌面 Helper');
  host.data = Buffer.from(code).toString('base64');
  const metadata = files.find(f => f.path === 'node_modules/dsh-pet/package.json');
  const adapted = JSON.parse(Buffer.from(metadata.data, 'base64'));
  delete adapted.dependencies['@electron/get']; delete adapted.dependencies['@electron-internal/extract-zip'];
  delete adapted.bin;
  adapted.offlineBuild = { recipe: 'dsh-pet-web-only', revision: 1, upstreamVersion: root.version };
  metadata.data = Buffer.from(JSON.stringify(adapted, null, 2)).toString('base64');
  // These entry points are not offered by the web-only delivery.
  for (let i = files.length - 1; i >= 0; i--) {
    if (/^node_modules\/dsh-pet\/(runtime\/|scripts\/|src\/|lib\/standalone\.js$)/.test(files[i].path)) files.splice(i, 1);
  }
  const bundle = { format: 2, name: root.name, version: root.version, revision: 1,
    profile: 'web', browserPeers: [...browserPeers],
    installNotes: 'Browser pet only. Existing pet settings are preserved; check display and network features.',
    dshVersion: '0.2.1-alpha.4', platform: 'linux', arch: 'x64', mode: 'web-only', packages, peers, files };
  check(!fs.existsSync(destination), 'Output already exists; do not overwrite a delivered bundle');
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
  const bytes = gzipSync(Buffer.from(JSON.stringify(bundle)));
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  fs.writeFileSync(`${destination}.sha256`, `${hash(bytes)}  ${path.basename(destination)}\n`, { flag: 'wx' });
  console.log(`Built ${destination}: ${files.length} files, ${Object.keys(packages).length} packages`);
}
