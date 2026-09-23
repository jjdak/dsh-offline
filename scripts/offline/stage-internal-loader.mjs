import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [app] = process.argv.slice(2)
if (!app) throw new Error('usage: stage-internal-loader.mjs APP')
const path = join(app, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
const original = await readFile(path, 'utf8')
const native = 'const addon = createRequire(import.meta.url)("node-addon-require-builtin");'
if (original.split(native).length !== 2) throw new Error('App boot internal module access changed; review compatibility patch')
// dsh-wrapper.sh already supplies --expose-internals on the pinned Node runtime.
await writeFile(path, original.replace(native, 'const addon = { requireBuiltin: createRequire(import.meta.url) }; // offline: --expose-internals'))
console.log('stage-internal-loader: app boot uses the pinned Node exposed internal loader')
