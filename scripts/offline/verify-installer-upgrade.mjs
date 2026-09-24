// Run only against trusted archives. All installations use a disposable HOME.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, readlink, unlink, rm, realpath, rename, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args.includes('--help')) {
  console.log('Usage: node verify-installer-upgrade.mjs OLD_ARCHIVE.tar.gz NEW_ARCHIVE.tar.gz');
  process.exit(args.includes('--help') ? 0 : 2);
}
const archives = await Promise.all(args.map(path => realpath(path)));
for (const archive of archives) {
  assert.match(basename(archive), /^dsh-offline-[\w.+-]+-linux-x64-glibc217-(text-only|image-wasm)\.tar\.gz$/);
  execFileSync('sha256sum', ['--check', '--strict', `${basename(archive)}.sha256`], {
    cwd: dirname(archive), stdio: 'inherit',
  });
}
const scripts = dirname(fileURLToPath(import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'dsh-install-upgrade.'));
try {
  const home = join(work, 'home');
  await mkdir(home);
  await writeFile(join(work, 'settings.yaml'), await readFile(join(scripts, 'settings-openai-compatible.yaml.example')));
  const template = await readFile(join(scripts, 'install-and-run.sh.in'), 'utf8');
  assert.equal(template.split('PUBLIC_ARCHIVE_PATH=""').length, 2);
  const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const installer = join(work, 'install.sh');
  await writeFile(installer, template.replace('PUBLIC_ARCHIVE_PATH=""', `PUBLIC_ARCHIVE_PATH=${shellQuote(join(work, 'latest'))}`));
  const env = { ...process.env, HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  delete env.DSH_HOME;
  delete env.XDG_DATA_HOME;
  const data = join(home, '.local/share/dsh-text-only');
  const markers = { 'settings.yaml': 'preserve-settings\n', '.env': 'PRESERVE_DUMMY=1\n', 'session-sentinel': 'preserve-session\n' };
  for (const [index, archive] of [archives[0], archives[0], archives[1], archives[1]].entries()) {
    if (index) await unlink(join(work, 'latest'));
    await symlink(archive, join(work, 'latest'));
    execFileSync('bash', [installer, '--yes', '--install-only'], { env, stdio: 'inherit' });
    if (!index) {
      for (const [name, value] of Object.entries(markers)) await writeFile(join(data, name), value);
    }
    for (const [name, value] of Object.entries(markers)) assert.equal(await readFile(join(data, name), 'utf8'), value);
    assert.equal(await readlink(join(home, '.local/bin/dsh')), join(home, '.local', basename(archive, '.tar.gz'), 'bin/dsh'));
  }
  console.log('PASS: initial/repeated install and upgrade preserve settings, dummy env and session marker');
  // Reproduce the on-disk state after the product's legacy import, then test
  // with and without a public seed. This is not a test of the importer itself.
  await rename(join(data, 'settings.yaml'), join(data, 'settings.yaml.imported'));
  const profileDir = join(data, 'profiles', 'migration-test');
  await mkdir(profileDir, { recursive: true });
  const profilePath = join(profileDir, 'cordis.patch.yml');
  const profileValue = '# user-edited profile must survive installation\n[]\n';
  await writeFile(profilePath, profileValue);
  for (const publicSeed of [true, false]) {
    if (!publicSeed) await unlink(join(work, 'settings.yaml'));
    execFileSync('bash', [installer, '--yes', '--install-only'], { env, stdio: 'inherit' });
    await assert.rejects(lstat(join(data, 'settings.yaml')), { code: 'ENOENT' });
    assert.equal(await readFile(join(data, 'settings.yaml.imported'), 'utf8'), markers['settings.yaml']);
    assert.equal(await readFile(profilePath, 'utf8'), profileValue);
    for (const name of ['.env', 'session-sentinel']) assert.equal(await readFile(join(data, name), 'utf8'), markers[name]);
  }
  console.log('PASS: migrated settings are not recreated; profile preserved with/without public seed');
} finally {
  await rm(work, { recursive: true, force: true });
}
