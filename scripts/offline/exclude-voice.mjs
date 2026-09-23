import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [app] = process.argv.slice(2)
if (!app) throw new Error('usage: exclude-voice.mjs APP')
const modules = join(app, 'node_modules')
const bundle = '@deepseek-ai/dsh-experimental-voice-input-bundle'
const excluded = new Set([
  bundle,
  '@deepseek-ai/dsh-experimental-speech-to-text',
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  '@deepseek-ai/dsh-experimental-api-speech-to-text',
  '@deepseek-ai/dsh-experimental-client-ui-voice-input',
])
const packages = []
for (const name of await readdir(modules)) {
  if (name.startsWith('.')) continue
  if (name.startsWith('@')) {
    for (const child of await readdir(join(modules, name))) packages.push(`${name}/${child}`)
  } else packages.push(name)
}
for (const name of packages) {
  if (name.startsWith('sherpa-onnx-')) excluded.add(name)
}
// Remove the shipped optional bundle from discovery, not just its native binding.
const boot = join(modules, '@deepseek-ai/dsh-app-boot/lib/index.js')
let bootText = await readFile(boot, 'utf8')
if (bootText.includes(bundle)) {
  const list = /const OPTIONAL_BUNDLES = \[([^\]]*)\];/
  if (!list.test(bootText)) throw new Error('Optional bundle registry changed; inspect before excluding voice')
  bootText = bootText.replace(list, (row, items) => {
    const values = JSON.parse(`[${items}]`).filter(name => name !== bundle)
    return `const OPTIONAL_BUNDLES = ${JSON.stringify(values)};`
  })
  if (bootText.includes(bundle)) throw new Error('Unexpected additional voice bundle reference')
  await writeFile(boot, bootText)
}
for (const name of ['', ...packages]) {
  if (excluded.has(name)) continue
  const path = join(name ? join(modules, name) : app, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  let changed = false
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'devDependencies']) {
    for (const dependency of excluded) {
      if (Object.hasOwn(manifest[field] ?? {}, dependency)) {
        delete manifest[field][dependency]
        changed = true
      }
    }
  }
  if (changed) await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
}
for (const name of excluded) await rm(join(modules, name), { recursive: true, force: true })
console.log('exclude-voice: optional voice bundle, UI, services and sherpa native runtime excluded')
