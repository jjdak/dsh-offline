// Diagnostic only: unpack trusted inputs in a temporary directory and use synthetic data.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [bundleFile, upstreamTar, output] = process.argv.slice(2);
assert.ok(bundleFile && upstreamTar && output, 'BUNDLE UPSTREAM_NPM_TGZ REPORT_DIR required');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(tmpdir(), 'dsh-memory-imports-'));
const bytes = fs.readFileSync(bundleFile);
const digest = createHash('sha256').update(bytes).digest('hex');
assert.equal(digest, fs.readFileSync(`${bundleFile}.sha256`, 'utf8').trim().split(/\s+/)[0]);
const bundle = JSON.parse(gunzipSync(bytes));
assert.equal(bundle.name, '@furongjun1999/dsh-memory');
const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(upstreamTar)).digest('base64');
assert.equal(integrity, bundle.inputs.npm.integrity);
const payload = path.join(scratch, 'payload');
for (const entry of bundle.files) {
  assert.ok(entry.path.startsWith('node_modules/@furongjun1999/dsh-memory/'));
  const dest = path.resolve(payload, entry.path);
  assert.ok(dest.startsWith(payload + path.sep), 'Unsafe payload path');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(entry.data, 'base64'), { mode: entry.mode, flag: 'wx' });
}
const upstream = path.join(scratch, 'upstream');
fs.mkdirSync(upstream);
execFileSync('tar', ['-xzf', upstreamTar, '-C', upstream]);
const plugin = path.join(payload, 'node_modules/@furongjun1999/dsh-memory');
const original = path.join(upstream, 'package');
// The runtime Python sources must be byte-for-byte identical to the official npm input.
let compared = 0;
for (const entry of bundle.files) {
  const rel = entry.path.slice('node_modules/@furongjun1999/dsh-memory/'.length);
  if (rel.startsWith('md_cg/') && rel.endsWith('.py')) {
    assert.deepEqual(fs.readFileSync(path.join(plugin, rel)), fs.readFileSync(path.join(original, rel)), rel);
    compared++;
  }
}
const python = path.join(plugin, 'python/bin/python3.12');
if (process.argv[5] === '--questions') {
  const { run } = await import('./diagnose-memory-questions.mjs');
  await run({ plugin, original, python, scratch, output, digest, compared });
  process.exit(0);
}
if (process.argv[5] === '--usage') {
  const { run } = await import('./diagnose-memory-usage.mjs');
  await run({ plugin, original, python, scratch, output, digest, compared });
  process.exit(0);
}
const script = fileURLToPath(new URL('./diagnose-memory-imports.py', import.meta.url));
function isolatedEnv(name) {
  const home = path.join(scratch, `home-${name}`);
  fs.mkdirSync(home);
  return { PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
    DSH_HOME: path.join(home, 'dsh'), MDCG_ROOT: path.join(home, 'memory'), MDCG_AUX_ROOT: path.join(home, 'aux'),
    DSH_TELEMETRY_DISABLED: '1' };
}
function scan(root, name, features) {
  const env = isolatedEnv(name);
  const text = execFileSync(python, ['-B', script, root, ...(features ? ['--features'] : [])], {
    env, cwd: scratch, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${name}.json`), text);
  return JSON.parse(text);
}
const upstreamReport = scan(original, 'upstream', true);
const offlineReport = scan(plugin, 'offline', true);
assert.deepEqual(offlineReport.unavailable, upstreamReport.unavailable);
assert.equal(offlineReport.fingerprint, upstreamReport.fingerprint);
assert.equal(offlineReport.unavailable.length, 26);
const featureChecks = offlineReport.features;
assert.equal(featureChecks.condition_algebra_import.message, "No module named 'numpy'");
assert.equal(featureChecks.aeis_ingest_text.exception, 'ModuleNotFoundError');
assert.equal(featureChecks.aeis_world3d.returned.status, 'world3d_not_ready');
assert.equal(featureChecks.compose_serial.returned.ok, true);
assert.equal(featureChecks.compose_parallel_without_numpy.returned.ok, true);
assert.equal(featureChecks.compose_parallel_without_numpy.returned.answer, featureChecks.compose_serial.returned.answer);
assert.equal(featureChecks.compose_parallel_without_numpy.returned.jacobian_steps, 0);
console.log(`PASS: ${compared} runtime Python files match npm; identical 26 unavailable imports and fingerprint ${offlineReport.fingerprint}`);
console.log('PASS: unavailable AEIS extensions reproduced; composition answers preserved without NumPy, Jacobian steps=0');

// Test the actual JS -> Python MCP path used by plugin hooks, not just direct Python calls.
const env = isolatedEnv('mcp');
for (const [key, value] of Object.entries(env)) process.env[key] = value;
const load = file => import(pathToFileURL(path.join(plugin, file)).href);
const { resolveToken } = await load('lib/lib/token_store.js');
const { MdcgClient } = await load('lib/lib/mdcg_client.js');
const credential = resolveToken({ python, actor: 'dsh-memory', clearance: 'private', autoIssue: true });
assert.ok(credential.token);
const options = { python, root: env.MDCG_ROOT, actor: 'dsh-memory', tenant: 'default', clearance: 'private',
  env: { MDCG_TOKEN: credential.token }, timeoutMs: 30000 };
const checks = [];
let client;
async function check(name, run, verify) {
  let result;
  try {
    result = await run();
    verify(result);
    checks.push({ name, ok: true, result });
    console.log(`PASS: ${name}`);
    return result;
  } catch (error) {
    checks.push({ name, ok: false, result, error: String(error) });
    console.log(`FAIL: ${name}: ${error}`);
  }
}
const contains = marker => value => assert.ok(JSON.stringify(value).includes(marker), `Missing ${marker}`);
const notError = value => { assert.ok(value != null); assert.notEqual(value.ok, false); assert.ok(!value.error); };
const marker = 'offline_import_diagnostic_20261016';
const timer = setTimeout(() => { console.error('Diagnostic timed out'); process.exit(1); }, 180000);
try {
  client = new MdcgClient(options); client.start();
  assert.ok(await client.waitReady());
  await check('MCP cg/stg discovery', () => client.bridge.listTools(), tools => {
    assert.ok(tools.some(t => t.name === 'cg') && tools.some(t => t.name === 'stg'));
  });
  const written = await check('durable code write', () => client.cg({ op: 'write',
    content: `${marker} = 42\n`, content_kind: 'code', layer: 'knowledge', sensitivity: 'internal' }),
    value => assert.equal(value.committed, true));
  const nodeId = written?.node_id ?? written?.id ?? written?.node?.id;
  assert.ok(nodeId);
  await check('exact read', () => client.get(nodeId), contains(marker));
  await check('keyword recall', () => client.recall(marker, 5), contains(marker));
  await check('budgeted recall', () => client.read(marker, { k: 5, budget_tokens: 1200 }), contains(marker));
  await check('stg timeline', () => client.timeline(20), contains(nodeId));
  const remembered = await check('automatic-memory client path', () => client.remember(
    '离线诊断：测试项目使用 34677 端口，用户要求记录部署约定。',
    { importance: 0.95, tags: ['offline-import-diagnostic'] }), value => {
      assert.equal(value.verdict, 'ACCEPT'); assert.ok(value.written && value.node_id);
    });
  assert.ok(remembered?.node_id);
  await check('automatic-memory exact read', () => client.get(remembered.node_id), contains('34677'));
  await check('recent event write', () => client.recentAdd('user', marker, { session: 'offline-diagnostic' }), notError);
  await check('session context recall', () => client.sessionRecall('offline-diagnostic', 10, 1200), contains(marker));
  await check('whitebox ping', () => client.whitebox('ping'), notError);
  await check('whitebox question answering', () => client.whitebox('ask', { question: '什么是条件论？' }), value => {
    assert.equal(value.ok, true); assert.ok(value.reply?.length > 0);
  });
  await check('whitebox existing knowledge verification', () => client.whitebox('verify_existing'),
    value => assert.equal(value.ok, true));
  await check('whitebox encode/read verification', () => client.whitebox('verify_encoding', {
    marker: '青色', fact: '离线诊断项目七三九的测试颜色是青色。',
    question: '离线诊断项目七三九的测试颜色是什么？',
  }), value => assert.equal(value.ok, true));
  client.dispose();
  await new Promise(resolve => setTimeout(resolve, 500));
  client = new MdcgClient(options); client.start();
  assert.ok(await client.waitReady());
  await check('exact read after restart', () => client.get(nodeId), contains(marker));
  await check('keyword recall after restart', () => client.recall(marker, 5), contains(marker));
  await check('automatic-memory read after restart', () => client.get(remembered.node_id), contains('34677'));
  await check('session context after restart', () => client.sessionRecall('offline-diagnostic', 10, 1200), contains(marker));
} finally {
  clearTimeout(timer); client?.dispose();
  fs.writeFileSync(path.join(output, 'mcp-features.json'), JSON.stringify({ bundleSha256: digest,
    comparedPythonFiles: compared, checks }, null, 2));
}
assert.ok(checks.length >= 15 && checks.every(c => c.ok), 'Some feature probes failed; inspect mcp-features.json');
console.log('PASS: memory diagnostic completed with disposable HOME/data, no network or real model API');
