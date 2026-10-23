// Uses only synthetic memory and the supplied temporary DSH_HOME/HOME.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const plugin = fs.realpathSync(process.argv[2]);
assert.ok(process.env.DSH_HOME && process.env.HOME, 'Temporary DSH_HOME/HOME are required');
const load = file => import(pathToFileURL(path.join(plugin, file)).href);
const { defaultPython } = await load('lib/lib/python_path.js');
const { resolveToken } = await load('lib/lib/token_store.js');
const { mdcgRoot } = await load('lib/lib/datapath.js');
const { MdcgClient } = await load('lib/lib/mdcg_client.js');
const python = defaultPython();
assert.equal(python, path.join(plugin, 'python/bin/python3.12'));
const version = execFileSync(python, ['-c', 'import sqlite3,ssl,sys;print(sys.version.split()[0])'], { encoding: 'utf8' }).trim();
assert.equal(version, '3.12.8');
const credential = resolveToken({ python, actor: 'dsh-memory', clearance: 'private', autoIssue: true });
assert.ok(credential.token, 'Automatic local token issuance failed');
const root = mdcgRoot('');
assert.ok(root.startsWith(process.env.DSH_HOME + path.sep), 'Memory escaped test DSH_HOME');
const options = { python, root, actor: 'dsh-memory', tenant: 'default', clearance: 'private', identity: '灵枢',
  env: { MDCG_TOKEN: credential.token }, timeoutMs: 20000 };
const timeout = setTimeout(() => { console.error('memory runtime test timed out'); process.exit(1); }, 90000);
let client;
try {
  client = new MdcgClient(options); client.start();
  assert.ok(await client.waitReady(), 'Python MCP handshake failed');
  const tools = await client.bridge.listTools();
  assert.ok(tools.some(t => t.name === 'cg') && tools.some(t => t.name === 'stg'));
  const info = await client.serviceInfo();
  console.log('memory info:', JSON.stringify(info).slice(0, 1400));
  const marker = 'DSH_OFFLINE_MEMORY_PERSISTENCE_20261016';
  const written = await client.cg({ op: 'write', content: `offline_memory_marker = "${marker}"\n`,
    content_kind: 'code', layer: 'knowledge', sensitivity: 'internal', tags: ['offline-smoke'] });
  console.log('memory write:', JSON.stringify(written));
  assert.equal(written.committed, true, 'Write accepted without durable commit');
  const nodeId = written.node_id ?? written.id ?? written.node?.id;
  assert.ok(nodeId, 'No committed node ID');
  client.dispose();
  await new Promise(resolve => setTimeout(resolve, 500));
  client = new MdcgClient(options); client.start();
  assert.ok(await client.waitReady(), 'Restarted MCP handshake failed');
  const result = await client.get(nodeId);
  assert.ok(JSON.stringify(result).includes(marker), 'Persisted memory not readable after restart');
  assert.ok(fs.existsSync(root));
  console.log('PASS: bundled Python, MCP tools, local token issuance, durable write/read after process restart');
} finally { clearTimeout(timeout); client?.dispose(); }
