import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [app, cache] = process.argv.slice(2)
if (!app || !cache) throw new Error('usage: stage-image-wasm.mjs APP CACHE')
const modules = join(app, 'node_modules')
const sharp = JSON.parse(await readFile(join(modules, 'sharp/package.json'), 'utf8'))
if (sharp.version !== '0.35.3') throw new Error(`Update pinned WASM input for sharp ${sharp.version}`)

// Keep a private dependency tree for WASM, independent of hoisted native-package dependencies.
const inputs = [
  ['@img/sharp-wasm32', '0.35.3', 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.3.tgz',
    'cZ0XkcYGpHZkqW6iCkqTcmUC0CD9DhD5d/qeZlZkfRBn6GnHniZXLUo5+9xw8Iv76YE6LQFN9YNBlKREcCG76w==', '@img/sharp-wasm32'],
  ['@emnapi/runtime', '1.11.3', 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz',
    'Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA==', '@img/sharp-wasm32/node_modules/@emnapi/runtime'],
  ['tslib', '2.8.1', 'https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz',
    'oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==', '@img/sharp-wasm32/node_modules/tslib'],
]
const scope = join(modules, '@img')
await mkdir(scope, { recursive: true })
for (const name of await readdir(scope)) {
  if (name.startsWith('sharp-')) await rm(join(scope, name), { recursive: true, force: true })
}
const record = []
for (const [name, version, url, integrity, destination] of inputs) {
  const archive = join(cache, `${name.replaceAll('/', '-').replace('@', '')}-${version}.tgz`)
  let bytes
  try { bytes = await readFile(archive) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    execFileSync('curl', ['--fail', '--location', '--show-error', '--output', `${archive}.part`, url], { stdio: 'inherit' })
    await rename(`${archive}.part`, archive)
    bytes = await readFile(archive)
  }
  if (createHash('sha512').update(bytes).digest('base64') !== integrity) throw new Error(`SHA-512 mismatch: ${archive}`)
  const target = join(modules, destination)
  await mkdir(target, { recursive: true })
  execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', target, '--strip-components=1'])
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== version) throw new Error(`Unexpected package: ${name}`)
  record.push({ name, version, url, integrity: `sha512-${integrity}` })
}
// Native bindings must never be attempted on CentOS 7, even if accidentally reintroduced later.
for (const extension of ['cjs', 'mjs']) {
  const entryPath = join(modules, `sharp/dist/sharp.${extension}`)
  const entry = await readFile(entryPath, 'utf8')
  if (!entry.includes('require("@img/sharp-wasm32/sharp.node")')) {
    throw new Error('sharp loader changed; inspect before patching WASM-only selection')
  }
  const header = '/*! Copyright 2013 Lovell Fuller and others. SPDX-License-Identifier: Apache-2.0 */\n// Offline glibc217 package: select only the pinned WASM binding.\n'
  const body = extension === 'cjs'
    ? 'module.exports = require("@img/sharp-wasm32/sharp.node");\n'
    : 'import sharp from "@img/sharp-wasm32/sharp.node";\nexport default sharp;\n'
  await writeFile(entryPath, header + body)
}
await writeFile(join(app, '..', 'IMAGE-RUNTIME.json'), JSON.stringify({ backend: 'wasm32', sharp: sharp.version, inputs: record }, null, 2) + '\n')
console.log('stage-image-wasm: pinned WASM runtime installed; native sharp bindings excluded')
