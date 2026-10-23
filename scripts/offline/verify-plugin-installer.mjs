// Contract checks for the shared installer using small independent plugin fixtures.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const runtime = fs.realpathSync(process.argv[2]);
const scripts = path.dirname(fileURLToPath(import.meta.url));
const work = fs.mkdtempSync(path.join(tmpdir(), 'dsh-generic-plugin.'));
const home = path.join(work, 'home');
const version = JSON.parse(fs.readFileSync(path.join(runtime, 'app/package.json'))).version;
const baseline = { dependencies: { 'existing-plugin': '1.0.0' }, dsh: { profile: { bundles: ['existing-plugin'], custom: 'preserve' } } };
const manifest = profile => path.join(home, 'profiles', profile, 'package.json');
const json = p => JSON.parse(fs.readFileSync(p));
const encode = (p, value) => ({ path: p, mode: 0o644, data: Buffer.from(value).toString('base64') });
function fixture(name, profile = 'web') {
  return { format: 2, name, version: '1.0.0', dshVersion: version, profile,
    platform: process.platform, arch: process.arch, packages: { [name]: '1.0.0' }, peers: {}, browserPeers: [],
    files: [encode(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })),
      encode(`node_modules/${name}/cordis.patch.yml`, '[]\n')] };
}
function pack(b, name) {
  const file = path.join(work, `${name}.dsh-plugin.gz`), bytes = gzipSync(JSON.stringify(b));
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(file)}\n`);
  return file;
}
function run(file, extra = [], expected = 0, selectedRuntime = runtime) {
  const result = spawnSync('bash', [path.join(scripts, 'install-plugin.sh'), file, '--runtime', selectedRuntime, '--home', home, '--stopped', ...extra], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result;
}
try {
  for (const profile of ['web', 'review']) {
    fs.mkdirSync(path.dirname(manifest(profile)), { recursive: true });
    fs.writeFileSync(manifest(profile), JSON.stringify(baseline, null, 2) + '\n');
    fs.writeFileSync(path.join(path.dirname(manifest(profile)), 'cordis.patch.yml'), '# user config\n[]\n');
  }
  const a = pack(fixture('example-alpha'), 'a');
  const b = pack(fixture('@example/beta'), 'b');
  run(a); run(b); run(a);
  assert.ok(json(manifest('web')).dsh.profile.bundles.includes('@example/beta'));
  // Rollback A after B was added, preserving B and unrelated user edits.
  const edited = json(manifest('web')); edited.userField = 'keep me';
  fs.writeFileSync(manifest('web'), JSON.stringify(edited, null, 2) + '\n');
  run(a, ['--rollback']);
  assert.equal(json(manifest('web')).userField, 'keep me');
  assert.ok(json(manifest('web')).dependencies['@example/beta']);
  assert.ok(!Object.hasOwn(json(manifest('web')).dependencies, 'example-alpha'));
  run(b, ['--rollback']);
  assert.deepEqual(json(manifest('web')), { ...baseline, userField: 'keep me' });
  run(a, ['--profile', 'review']);
  assert.ok(json(manifest('review')).dependencies['example-alpha']);
  assert.ok(!json(manifest('web')).dependencies['example-alpha']);
  run(a, ['--profile', 'review', '--rollback']);
  assert.deepEqual(json(manifest('review')), baseline);
  // The target profile can also come entirely from the bundle metadata.
  const target = pack(fixture('@example/profile-default', 'review'), 'profile-default');
  run(target); run(target, ['--rollback']);
  // Rejected identities/paths/versions must not change the profile.
  const before = fs.readFileSync(manifest('web'), 'utf8');
  const wrong = fixture('wrong-runtime'); wrong.dshVersion = '999.0.0';
  assert.match(run(pack(wrong, 'wrong-runtime'), [], 1).stderr, /DSH requires >=/);
  const unsafe = fixture('unsafe'); unsafe.files[0].path = 'node_modules/../../escape';
  assert.match(run(pack(unsafe, 'unsafe'), [], 1).stderr, /Unsafe/);
  const identity = fixture('identity'); identity.name = '../escape';
  assert.match(run(pack(identity, 'identity'), [], 1).stderr, /identity/);
  assert.match(run(a, ['--profile', '../escape'], 1).stderr, /profile/);
  assert.equal(fs.readFileSync(manifest('web'), 'utf8'), before);
  // Simulated host versions test installer compatibility and dependency rebinding,
  // not actual product behavior of those releases.
  const semver = createRequire(path.join(runtime, 'app/package.json')).resolve('semver/package.json');
  function host(v, peerVersion = v) {
    const root = path.join(work, `runtime-${v}`), app = path.join(root, 'app');
    fs.mkdirSync(path.join(root, 'node/bin'), { recursive: true });
    fs.symlinkSync(path.join(runtime, 'node/bin/node'), path.join(root, 'node/bin/node'));
    fs.mkdirSync(path.join(app, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: v }));
    fs.symlinkSync(path.dirname(semver), path.join(app, 'node_modules/semver'));
    const peer = path.join(app, 'node_modules/@deepseek-ai/dsh-llm');
    fs.mkdirSync(peer, { recursive: true });
    fs.writeFileSync(path.join(peer, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm', version: peerVersion }));
    return root;
  }
  const old = host('0.2.1-alpha.4'), newer = host('0.2.1-rc.1');
  const tooOld = host('0.1.7-rc.1');
  const plugin = fixture('@example/upgrade');
  plugin.peers = { '@deepseek-ai/dsh-llm': '^0.2.0-rc.1' };
  const upgrade = pack(plugin, 'upgrade');
  run(upgrade, [], 0, old);
  const upgradeLink = path.join(home, 'profiles/web/node_modules/@example/upgrade');
  // Reproduce a pre-upgrade installer receipt without the host-specific suffix.
  const installedTarget = fs.readlinkSync(upgradeLink);
  const installedRoot = path.resolve(installedTarget, '..', '..', '..');
  const legacyRoot = installedRoot.replace(/-host-[a-f0-9]+$/, '');
  fs.renameSync(installedRoot, legacyRoot);
  const oldTarget = path.join(legacyRoot, 'node_modules/@example/upgrade');
  fs.unlinkSync(upgradeLink); fs.symlinkSync(oldTarget, upgradeLink);
  const legacyManifest = json(manifest('web')); legacyManifest.dependencies['@example/upgrade'] = `link:${oldTarget}`;
  const legacyText = JSON.stringify(legacyManifest, null, 2) + '\n';
  fs.writeFileSync(manifest('web'), legacyText);
  const receiptPath = path.join(home, 'offline-plugins', `${encodeURIComponent('@example/upgrade')}.receipt.json`);
  const legacyReceipt = json(receiptPath); legacyReceipt.target = oldTarget;
  legacyReceipt.afterHash = createHash('sha256').update(legacyText).digest('hex');
  delete legacyReceipt.runtime; delete legacyReceipt.runtimeVersion;
  fs.writeFileSync(receiptPath, JSON.stringify(legacyReceipt));
  const manifestWithUserEdit = json(manifest('web')); manifestWithUserEdit.duringUpgrade = 'preserved';
  fs.writeFileSync(manifest('web'), JSON.stringify(manifestWithUserEdit, null, 2) + '\n');
  // Even after the old program has been removed, reinstallation must bind to the new host.
  fs.rmSync(old, { recursive: true, force: true });
  assert.match(run(upgrade, [], 0, newer).stdout, /Rebound/);
  const newTarget = fs.readlinkSync(upgradeLink);
  assert.notEqual(newTarget, oldTarget);
  const peerLink = path.resolve(newTarget, '..', '..', '@deepseek-ai/dsh-llm');
  assert.equal(fs.realpathSync(peerLink), path.join(newer, 'app/node_modules/@deepseek-ai/dsh-llm'));
  const unchanged = fs.readFileSync(manifest('web'), 'utf8');
  assert.match(run(upgrade, [], 0, newer).stdout, /Already installed/);
  assert.equal(fs.readFileSync(manifest('web'), 'utf8'), unchanged);
  assert.match(run(upgrade, [], 1, tooOld).stderr, /requires >=0.2.0-rc.1/);
  run(upgrade, ['--rollback'], 0, newer);
  assert.equal(json(manifest('web')).duringUpgrade, 'preserved');
  assert.ok(!json(manifest('web')).dependencies['@example/upgrade']);
  // Above-minimum hosts pass even outside an upstream caret range, as requested.
  const future = host('0.3.0');
  run(upgrade, [], 0, future); run(upgrade, ['--rollback'], 0, future);
  const badPeer = host('0.2.2', '0.1.0');
  assert.match(run(upgrade, [], 1, badPeer).stderr, /dsh-llm requires >=/);
  const enginePlugin = fixture('engine-minimum');
  enginePlugin.dshVersion = '999.0.0'; // Build/test host is metadata when an explicit requirement exists.
  const metaFile = enginePlugin.files[0];
  const meta = JSON.parse(Buffer.from(metaFile.data, 'base64'));
  meta.engines = { dsh: '>=0.2.0-rc.1' };
  metaFile.data = Buffer.from(JSON.stringify(meta)).toString('base64');
  const engineBundle = pack(enginePlugin, 'engine');
  run(engineBundle, [], 0, newer); run(engineBundle, ['--rollback'], 0, newer);
  assert.match(run(engineBundle, [], 1, tooOld).stderr, /requires >=0.2.0-rc.1/);
  const laterRc = host('0.2.1-rc.10');
  meta.engines.dsh = '>=0.2.1-rc.2';
  metaFile.data = Buffer.from(JSON.stringify(meta)).toString('base64');
  const rcBundle = pack(enginePlugin, 'rc-ordering');
  assert.match(run(rcBundle, [], 1, newer).stderr, /requires >=0.2.1-rc.2/);
  run(rcBundle, [], 0, laterRc); run(rcBundle, ['--rollback'], 0, laterRc);
  const nonDsh = fixture('non-dsh-range'); nonDsh.peers = { semver: '>=999.0.0' };
  assert.match(run(pack(nonDsh, 'non-dsh-range'), [], 1).stderr, /Host peer mismatch/);
  // The main installer must repair existing plugins without their original bundles.
  const automaticOldHost = host('0.2.1-alpha.5');
  const automatic = [fixture('auto-alpha'), fixture('@example/auto-beta', 'review')];
  const bundles = automatic.map((entry, i) => {
    entry.peers = { '@deepseek-ai/dsh-llm': '^0.2.0-rc.1' };
    const meta = JSON.parse(Buffer.from(entry.files[0].data, 'base64'));
    meta.peerDependencies = entry.peers;
    entry.files[0].data = Buffer.from(JSON.stringify(meta)).toString('base64');
    const file = pack(entry, `auto-${i}`); run(file, [], 0, automaticOldHost); return file;
  });
  const receipts = automatic.map(entry => path.join(home, 'offline-plugins', entry.profile === 'web' ? '' : `.receipts/${entry.profile}`, `${encodeURIComponent(entry.name)}.receipt.json`));
  const targets = receipts.map(file => json(file).target);
  const legacyAuto = json(receipts[0]);
  for (const key of ['runtime', 'runtimeVersion', 'hostRequirements', 'browserPeers', 'buildDshVersion']) delete legacyAuto[key];
  fs.writeFileSync(receipts[0], JSON.stringify(legacyAuto));
  const profileTexts = ['web', 'review'].map(profile => fs.readFileSync(manifest(profile), 'utf8'));
  fs.rmSync(automaticOldHost, { recursive: true, force: true });
  function autoRebind(selectedRuntime, expected = 0) {
    const result = spawnSync(path.join(runtime, 'node/bin/node'), [path.join(scripts, 'rebind-plugin-host.mjs'), selectedRuntime, home], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, expected, result.stdout + result.stderr); return result;
  }
  autoRebind(newer);
  const peerSlots = automatic.map((entry, i) => path.resolve(targets[i], ...entry.name.split('/').map(() => '..'), '@deepseek-ai/dsh-llm'));
  for (const [i, entry] of automatic.entries()) {
    assert.equal(json(receipts[i]).target, targets[i]);
    assert.equal(fs.realpathSync(peerSlots[i]), path.join(newer, 'app/node_modules/@deepseek-ai/dsh-llm'));
    assert.equal(fs.readFileSync(manifest(entry.profile), 'utf8'), profileTexts[i]);
    assert.match(run(bundles[i], [], 0, newer).stdout, /Already installed/);
  }
  const receiptTexts = receipts.map(file => fs.readFileSync(file, 'utf8'));
  assert.match(autoRebind(newer).stdout, /更新 0 个/);
  for (const [i, file] of receipts.entries()) assert.equal(fs.readFileSync(file, 'utf8'), receiptTexts[i]);
  // A failure in the second plugin must not partially rebind the first one.
  const betaMeta = path.join(targets[1], 'package.json'), betaBefore = fs.readFileSync(betaMeta, 'utf8');
  const betaChanged = JSON.parse(betaBefore); betaChanged.engines = { dsh: '>=1.0.0' };
  fs.writeFileSync(betaMeta, JSON.stringify(betaChanged));
  assert.match(autoRebind(future, 1).stderr, /requires at least 1.0.0/);
  for (const slot of peerSlots) assert.equal(fs.realpathSync(slot), path.join(newer, 'app/node_modules/@deepseek-ai/dsh-llm'));
  for (const [i, file] of receipts.entries()) assert.equal(fs.readFileSync(file, 'utf8'), receiptTexts[i]);
  fs.writeFileSync(betaMeta, betaBefore);
  for (const bundle of bundles) run(bundle, ['--rollback'], 0, newer);
  for (const profile of ['web', 'review']) {
    assert.equal(fs.readFileSync(path.join(path.dirname(manifest(profile)), 'cordis.patch.yml'), 'utf8'), '# user config\n[]\n');
  }
  console.log('PASS: generic plugins, minimum versions, manual/automatic host rebinding, legacy receipts, profile preservation and preflight failure atomicity');
} finally { fs.rmSync(work, { recursive: true, force: true }); }
