// Compare the documented normal memory path with the separate whitebox diagnostic.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { facts } from './diagnose-memory-questions.mjs';

export async function run({ plugin, original, python, scratch, output, digest, compared }) {
  const home = path.join(scratch, 'usage-home');
  fs.mkdirSync(home);
  Object.assign(process.env, { HOME: home, DSH_HOME: path.join(home, 'dsh'),
    MDCG_AUX_ROOT: path.join(home, 'aux'), PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' });
  const load = file => import(pathToFileURL(path.join(plugin, file)).href);
  const { resolveToken } = await load('lib/lib/token_store.js');
  const { MdcgClient } = await load('lib/lib/mdcg_client.js');
  const credential = resolveToken({ python, actor: 'dsh-memory', clearance: 'private', autoIssue: true });
  assert.ok(credential.token);
  const reports = {};
  async function arm(label, codeRoot) {
    const results = [];
    async function start(id) {
      const client = new MdcgClient({ python, root: path.join(scratch, `usage-${label}`, id), actor: 'dsh-memory',
        clearance: 'private', tenant: 'default', timeoutMs: 30000,
        env: { MDCG_TOKEN: credential.token, PYTHONPATH: codeRoot } });
      client.start(); assert.ok(await client.waitReady()); return client;
    }
    for (const fixture of facts) {
      let client = await start(fixture.id);
      const item = { id: fixture.id, fact: fixture.fact, expectedValue: fixture.marker, reads: [] };
      try {
        // This is the documented automatic-memory path and its default importance.
        item.write = await client.remember(fixture.fact, { importance: 0.6, tags: ['dsh', 'offline-usage'], sensitivity: 'internal' });
        const nodeId = item.write.node_id ?? item.write.written;
        if (typeof nodeId === 'string') {
          item.get = await client.get(nodeId);
          item.exactReadContainsValue = JSON.stringify(item.get).includes(fixture.marker);
        }
        for (const question of fixture.questions) {
          const response = await client.read(question, { k: 5 });
          const contains = (response.results ?? []).some(r => JSON.stringify(r.node).includes(fixture.marker));
          item.reads.push({ question, contains, response });
        }
        if (typeof nodeId === 'string') {
          client.dispose();
          await new Promise(resolve => setTimeout(resolve, 300));
          client = await start(fixture.id);
          const response = await client.get(nodeId);
          item.afterRestart = { contains: JSON.stringify(response).includes(fixture.marker), response };
        }
      } catch (error) { item.error = String(error); }
      finally { client.dispose(); }
      results.push(item);
      fs.writeFileSync(path.join(output, `${label}-usage.json`), JSON.stringify(results, null, 2));
      console.log(`${label}/${fixture.id}: verdict=${item.write?.verdict} exact=${item.exactReadContainsValue} retrieval=${item.reads.filter(r => r.contains).length}/4 restart=${item.afterRestart?.contains} error=${item.error ?? ''}`);
    }
    const client = await start('explicit-six-field-text');
    let explicit;
    try {
      const content = '# 功能名：星舟服务端口约定\n# 生效条件：部署和访问星舟服务时\n# 子功能：记录服务端口\n# 执行：星舟服务的监听端口是34677。\n# 验证方式：data\n# 不适用条件：其他服务或端口变更后\n';
      const written = await client.cg({ op: 'write', content, content_kind: 'text',
        layer: 'knowledge', sensitivity: 'internal', verification_basis: 'data' });
      const read = await client.read('星舟服务监听哪个端口？', { k: 5 });
      explicit = { written, read, contains: JSON.stringify(read.results ?? []).includes('34677') };
      console.log(`${label}/explicit-text: committed=${written.committed} retrieval=${explicit.contains}`);
    } finally { client.dispose(); }
    reports[label] = { results, explicit, totalReads: results.reduce((n, r) => n + r.reads.length, 0),
      matchingReads: results.reduce((n, r) => n + r.reads.filter(x => x.contains).length, 0) };
    fs.writeFileSync(path.join(output, `${label}-usage.json`), JSON.stringify(reports[label], null, 2));
  }
  await Promise.all([arm('offline', plugin), arm('upstream', original)]);
  fs.writeFileSync(path.join(output, 'usage-summary.json'), JSON.stringify({ bundleSha256: digest,
    comparedPythonFiles: compared, note: 'Retrieval supplies evidence; no LLM final answer is generated. One fact per isolated memory root, not a retrieval benchmark.', reports }, null, 2));
  console.log('USAGE SUMMARY:', JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k, v]) =>
    [k, { totalReads: v.totalReads, matchingReads: v.matchingReads, writes: v.results.map(r => r.write?.verdict),
      restarts: v.results.filter(r => r.afterRestart?.contains).length, explicitCommitted: v.explicit.written.committed }]))));
}
