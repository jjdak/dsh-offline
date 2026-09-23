import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [app] = process.argv.slice(2)
if (!app) throw new Error('usage: verify-native-runtime.mjs APP')
const require = createRequire(join(app, 'package.json'))
const load = specifier => import(pathToFileURL(require.resolve(specifier)))
const { Context } = await load('@deepseek-ai/cordis')
const { default: Runtime } = await load('@deepseek-ai/dsh-subprocess-local')
const { tryLockExclusive } = await load('@deepseek-ai/node-addon-system/flock')
const { launcherPath, grantArgs } = await load('@deepseek-ai/node-addon-system/landlock-run')
const { OPTIONAL_BUNDLES } = await load('@deepseek-ai/dsh-app-boot')
assert.ok(!OPTIONAL_BUNDLES.includes('@deepseek-ai/dsh-experimental-voice-input-bundle'))
assert.ok(!(await readdir(join(app, 'node_modules'))).some(name => name.startsWith('sherpa-onnx-')))
assert.ok(!(await readdir(join(app, 'node_modules/@deepseek-ai'))).some(name => /experimental-(?:voice-input|speech-to-text|api-speech-to-text|client-ui-voice-input)/.test(name)))
console.log('native-smoke: voice discovery, services and native runtime absent')
const home = await mkdtemp(join(tmpdir(), 'dsh-native-smoke.'))
const ctx = new Context()
const fiber = await ctx.plugin(Runtime)
const timeout = setTimeout(() => { console.error('native-smoke: timed out'); process.exit(1) }, 30000)
try {
  const lock1 = await open(join(home, 'lock'), 'w+')
  const lock2 = await open(join(home, 'lock'), 'r+')
  try {
    await tryLockExclusive(lock1.fd)
    await assert.rejects(tryLockExclusive(lock2.fd), error => ['EAGAIN', 'EWOULDBLOCK'].includes(error.code))
    await lock1.close()
    await tryLockExclusive(lock2.fd)
  } finally {
    await lock1.close()
    await lock2.close()
  }
  console.log('native-smoke: file lock acquisition/contention/release passed')
  const handle = ctx.subprocess.spawn({
    argv: [launcherPath(), ...grantArgs({ readOnly: ['/'], readWrite: [home] }), '--', '/bin/bash', '-c', 'printf native-ok > result; cat result'],
    cwd: home,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64000 }, stderr: { maxBytes: 64000 } },
    graceMs: 200,
  })
  const outcome = await handle.done
  await handle.waitForExit()
  assert.equal(outcome.exitCode, 0, handle.collected.stderr?.readFrom(0).text)
  assert.equal(handle.collected.stdout.readFrom(0).text, 'native-ok')
  assert.equal(await readFile(join(home, 'result'), 'utf8'), 'native-ok')
  console.log('native-smoke: packaged subprocess runner and sandboxed Bash file I/O passed')
  const pty = require('node-pty')
  await new Promise((resolve, reject) => {
    const terminal = pty.spawn('/bin/bash', ['-c', 'printf pty-ok'], { cwd: home, env: process.env, cols: 80, rows: 24 })
    let output = ''
    terminal.onData(data => { output += data })
    terminal.onExit(({ exitCode }) => {
      try { assert.equal(exitCode, 0); assert.match(output, /pty-ok/); resolve() } catch (error) { reject(error) }
    })
  })
  console.log('native-smoke: PTY passed')
} finally {
  clearTimeout(timeout)
  await fiber.dispose()
  await rm(home, { recursive: true, force: true })
}
