// Focused whitebox question variants. Run via diagnose-memory-imports.sh --questions.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const facts = [
  { id: 'color', fact: '离线诊断项目七三九的测试颜色是青色。', marker: '青色',
    questions: ['离线诊断项目七三九的测试颜色是什么？', '项目七三九用哪种颜色做测试？',
      '还记得之前说过的离线诊断项目七三九的测试颜色吗？', '离线诊断项目七三九的测试颜色是不是橙色？'] },
  { id: 'port', fact: '星舟服务的监听端口是34677。', marker: '34677',
    questions: ['星舟服务监听哪个端口？', '访问星舟服务需要填写什么端口号？',
      '还记得之前说过的星舟服务端口是多少吗？', '星舟服务是不是监听12345端口？'] },
  { id: 'person', fact: '澄月项目的负责人是林舟。', marker: '林舟',
    questions: ['澄月项目的负责人是谁？', '谁负责澄月项目？',
      '还记得之前说过由谁负责澄月项目吗？', '澄月项目是不是由赵川负责？'] },
  { id: 'location', fact: '白鹭备件箱放在二楼资料室。', marker: '二楼资料室',
    questions: ['白鹭备件箱放在哪里？', '我应该去哪里找白鹭备件箱？',
      '还记得之前说过白鹭备件箱放在哪里吗？', '白鹭备件箱是不是放在一楼大厅？'] },
  { id: 'date', fact: '晨星演练安排在2027年3月18日。', marker: '2027年3月18日',
    questions: ['晨星演练安排在哪一天？', '晨星演练的具体日期是什么？',
      '还记得之前说过晨星演练在哪一天举行吗？', '晨星演练是不是安排在2027年4月2日？'] },
  { id: 'quantity', fact: '玄石仓库现有47台备用终端。', marker: '47',
    questions: ['玄石仓库有多少台备用终端？', '玄石仓库备用终端的数量是多少？',
      '还记得之前说过玄石仓库有几台备用终端吗？', '玄石仓库是不是有12台备用终端？'] },
  { id: 'english', fact: 'The access code for Project Cedar is CEDAR-7824.', marker: 'CEDAR-7824',
    questions: ['What is the access code for Project Cedar?', 'Which code should I use to access Project Cedar?',
      'Do you remember the access code I told you for Project Cedar?', 'Is the access code for Project Cedar CEDAR-0000?'] },
  { id: 'token', fact: '本次离线测试口令是ZEBRA-57319，请记住。', marker: 'ZEBRA-57319',
    questions: ['本次离线测试口令是什么？', '请告诉我离线测试使用的口令。',
      '请只回答刚才记住的口令本身，不要解释。', '本次离线测试口令是不是ZEBRA-00000？'] },
];
const kinds = ['direct', 'paraphrase', 'memory_cue', 'wrong_yes_no'];

export async function run({ plugin, original, python, scratch, output, digest, compared }) {
  const home = path.join(scratch, 'question-home');
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
    const base = path.join(scratch, `questions-${label}`);
    fs.mkdirSync(base);
    // Seed once, then copy a closed database for independent per-fact fixtures.
    const seed = path.join(base, 'seed.db');
    execFileSync(python, ['-B', '-c',
      'import sys;sys.path.insert(0,sys.argv[1]);from md_cg.whitebox_kb.engine import WhiteboxEngine;e=WhiteboxEngine(db_path=sys.argv[2]);e.service_info()',
      codeRoot, seed], { cwd: scratch, env: { ...process.env, PYTHONPATH: codeRoot }, timeout: 90000 });
    async function open(id) {
      const root = path.join(base, id);
      fs.mkdirSync(root);
      const db = path.join(root, 'whitebox.db');
      fs.copyFileSync(seed, db);
      const client = new MdcgClient({ python, root: path.join(root, 'memory'), actor: 'dsh-memory',
        clearance: 'private', tenant: 'default', timeoutMs: 45000,
        env: { MDCG_TOKEN: credential.token, PYTHONPATH: codeRoot, MDCG_WHITEBOX_DB: db } });
      client.start();
      assert.ok(await client.waitReady(), `${label}/${id}: MCP handshake failed`);
      return { client, db };
    }
    for (const fixture of facts) {
      const { client, db } = await open(fixture.id);
      try {
        for (let i = 0; i < fixture.questions.length; i++) {
          const question = fixture.questions[i];
          const response = await client.whitebox('verify_encoding', { fact: fixture.fact, marker: fixture.marker,
            question, session_id: `${label}-${fixture.id}-${i}` });
          const storedCount = Number(execFileSync(python, ['-B', '-c',
            'import sqlite3,sys;c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);print(c.execute("select count(*) from nodes where content=?",(sys.argv[2],)).fetchone()[0])',
            db, fixture.fact], { encoding: 'utf8', timeout: 5000 }).trim());
          const item = { factId: fixture.id, kind: kinds[i], fact: fixture.fact, expectedValue: fixture.marker,
            question, storedCount, valuePresent: (response.reply ?? '').includes(fixture.marker), response };
          results.push(item);
          fs.writeFileSync(path.join(output, `${label}-questions.json`), JSON.stringify(results, null, 2));
          console.log(`${label}/${fixture.id}/${kinds[i]}: encoded=${response.encoded} stored=${storedCount} valuePresent=${item.valuePresent} reply=${JSON.stringify(response.reply)}`);
        }
      } finally { client.dispose(); }
    }
    const { client } = await open('controls');
    const controls = [];
    try {
      for (const question of ['什么是条件论？', '为什么高原上煮饭不容易熟？', '你好', '未提供过的紫杉项目的测试颜色是什么？']) {
        const response = await client.whitebox('ask', { question, session_id: `${label}-control-${controls.length}` });
        controls.push({ question, response });
        console.log(`${label}/control: ${JSON.stringify(question)} => ${JSON.stringify(response.reply)}`);
      }
      // The upstream self-check's completely default fact and question, too.
      const response = await client.whitebox('verify_encoding', { session_id: `${label}-default-probe` });
      controls.push({ question: '(upstream verify_encoding defaults)', response });
      console.log(`${label}/default-probe: ok=${response.ok} encoded=${response.encoded} recalled=${response.recalled}`);
    } finally { client.dispose(); }
    fs.writeFileSync(path.join(output, `${label}-controls.json`), JSON.stringify(controls, null, 2));
    reports[label] = { total: results.length, encoded: results.filter(r => r.response.encoded === true).length,
      stored: results.filter(r => r.storedCount > 0).length, valuePresent: results.filter(r => r.valuePresent).length,
      verificationPassed: results.filter(r => r.response.ok === true).length, controls };
  }
  // Separate processes, code roots, memory roots and databases; only temporary auth is shared.
  await Promise.all([arm('offline', plugin), arm('upstream', original)]);
  fs.writeFileSync(path.join(output, 'question-summary.json'), JSON.stringify({ bundleSha256: digest,
    comparedPythonFiles: compared, note: 'valuePresent is a literal answer-value check, not a semantic accuracy score; inspect yes/no replies manually',
    reports }, null, 2));
  console.log('QUESTION SUMMARY:', JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k, v]) =>
    [k, { total: v.total, encoded: v.encoded, stored: v.stored, valuePresent: v.valuePresent, verificationPassed: v.verificationPassed }]))));
}
