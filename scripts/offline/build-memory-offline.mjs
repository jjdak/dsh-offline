// Reviewed dsh-memory recipe. Run through build-memory-container.sh for pinned inputs and ELF audit.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const inputs = {
  npm: { version: '0.8.1', integrity: 'sha512-PG9H5tgOWrj+uvmIqiCsoNRfr19XI4G6MxnjgAAyMAB2erp2IqpYeVv6FtV/5JZnDe3BO3Va1PpuDnw5toI/Bg==',
    url: 'https://registry.npmjs.org/@furongjun1999/dsh-memory/-/dsh-memory-0.8.1.tgz' },
  python: { version: '3.12.8', release: '20241206', sha256: 'b9d6ee5ddac1198e72d53112698773fc8bb597de095592eb849ca794306699ba',
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20241206/cpython-3.12.8%2B20241206-x86_64-unknown-linux-gnu-install_only.tar.gz' },
};
const check = (ok, text) => { if (!ok) throw new Error(text); };
export function build(source, destination, pythonRoot) {
  check(pythonRoot, 'Use build-memory-container.sh to supply the audited portable Python');
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  check(metadata.name === '@furongjun1999/dsh-memory' && metadata.version === inputs.npm.version, 'Unreviewed dsh-memory input');
  check(!Object.keys(metadata.dependencies ?? {}).length, 'New runtime dependencies require review');
  check(!fs.existsSync(destination), 'Output already exists');
  const prefix = `node_modules/${metadata.name}`, files = [];
  function collect(full, rel, native = false) {
    const name = path.basename(full), stat = fs.lstatSync(full);
    if (['__pycache__', 'node_modules', '.git', 'site-packages', 'ensurepip', 'idlelib', 'tkinter', 'turtledemo', 'test', 'tests'].includes(name)
      || /^test_.*\.py$/.test(name) || /\.(pyc|a)$/.test(name)) return;
    check(!/^\.env(?:\.|$)/.test(name) && !/\.(env|pem|key)$/.test(name) && name !== '.npmrc', `Sensitive filename: ${full}`);
    check(!stat.isSymbolicLink(), `Unexpected symlink: ${full}`);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) collect(path.join(full, child), `${rel}/${child}`, native);
    } else {
      check(stat.isFile(), `Unexpected file: ${full}`);
      const bytes = fs.readFileSync(full);
      const elf = bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]));
      check(native || !elf, `Unexpected native input: ${full}`);
      files.push({ path: rel, mode: stat.mode & 0o111 ? 0o755 : 0o644, data: bytes.toString('base64') });
    }
  }
  for (const dir of ['lib', 'md_cg', 'skills']) collect(path.join(source, dir), `${prefix}/${dir}`);
  for (const file of ['package.json', 'LICENSE', 'README.md', 'utf8_boot.py', 'data/policy.json', 'dsh/cordis.patch.yml']) {
    collect(path.join(source, file), `${prefix}/${file}`);
  }
  for (const file of ['bin/python3.12', 'lib/libpython3.12.so.1.0', 'lib/libpython3.so', 'lib/python3.12']) {
    collect(path.join(pythonRoot, file), `${prefix}/python/${file}`, true);
  }
  for (const f of ['share/licenses', 'licenses']) {
    if (fs.existsSync(path.join(pythonRoot, f))) collect(path.join(pythonRoot, f), `${prefix}/python/${f}`);
  }
  const resolver = files.find(f => f.path === `${prefix}/lib/lib/python_path.js`);
  let code = Buffer.from(resolver.data, 'base64').toString('utf8');
  const original = "return platform === 'win32' ? 'python' : 'python3';";
  check(code.split(original).length === 2, 'Python resolver changed upstream');
  code = "import { fileURLToPath } from 'node:url';\n" + code.replace(original,
    "return fileURLToPath(new URL('../../python/bin/python3.12', import.meta.url));");
  resolver.data = Buffer.from(code).toString('base64');
  metadata.files = ['lib', 'md_cg', 'skills', 'python', 'data/policy.json', 'dsh/cordis.patch.yml', 'utf8_boot.py', 'LICENSE', 'README.md'];
  metadata.offlineBuild = { recipe: 'dsh-memory-portable-python', revision: 1, inputs };
  files.find(f => f.path === `${prefix}/package.json`).data = Buffer.from(JSON.stringify(metadata, null, 2)).toString('base64');
  const bundle = { format: 2, name: metadata.name, version: metadata.version, revision: 1,
    profile: 'web', dshVersion: '0.2.1-alpha.4', platform: 'linux', arch: 'x64',
    browserPeers: [], packages: { [metadata.name]: metadata.version }, peers: metadata.peerDependencies,
    installNotes: 'Lingshu includes portable Python. Restart DSH; memory is under DSH_HOME/.dsh-memory, credentials under ~/.mdcg. Back up both.',
    inputs, files };
  fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
  const bytes = gzipSync(JSON.stringify(bundle));
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  const digest = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(`${destination}.sha256`, `${digest}  ${path.basename(destination)}\n`, { flag: 'wx' });
  console.log(`Built ${destination}: ${files.length} files, ${(bytes.length / 1048576).toFixed(1)} MiB`);
}
