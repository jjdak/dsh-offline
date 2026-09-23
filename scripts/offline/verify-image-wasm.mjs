import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [app] = process.argv.slice(2)
if (!app) throw new Error('usage: verify-image-wasm.mjs APP')
const require = createRequire(join(app, 'package.json'))
const sharp = require('sharp')
assert.equal(sharp.versions.sharp, '0.35.3')
assert.ok(Object.keys(require.cache).some(path => path.includes('/@img/sharp-wasm32/')))
const imgPackages = await readdir(join(app, 'node_modules/@img'))
assert.deepEqual(imgPackages.filter(name => name.startsWith('sharp-')), ['sharp-wasm32'])
const webBundle = await readFile(join(app, 'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml'), 'utf8')
assert.match(webBundle, /id: ui-attachment\n\s+name: '@deepseek-ai\/dsh-client-ui-attachment'/)
assert.doesNotMatch(webBundle, /id: ui-attachment\n\s+name: '@deepseek-ai\/dsh-client-ui-attachment'\n\s+disabled: true/)
const { Context } = await import(pathToFileURL(join(app, 'node_modules/@deepseek-ai/cordis/lib/index.js')))
const { default: Store } = await import(pathToFileURL(join(app, 'node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js')))
const home = await mkdtemp(join(tmpdir(), 'dsh-image-smoke.'))
try {
  const store = new Store(new Context(), { dshHome: home, normalizedImageMaxPixels: 4096, normalizedImageMaxDimension: 64 })
  assert.deepEqual([...store.imageLimits.mediaTypes].sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const data = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#2378ab' } })[format]().toBuffer()
    const [ref] = await store.saveImages([{ data, mediaType: `image/${format}`, name: `sample.${format}` }])
    const stored = await store.readImage(ref)
    const metadata = await sharp(stored.data).metadata()
    assert.ok(metadata.width <= 64 && metadata.height <= 64)
    assert.ok(stored.data.length > 0)
    assert.deepEqual(await readFile(store.imageHostPath(ref)), Buffer.from(stored.data))
    const request = await store.readImageRequest(ref, { width: 32, height: 32, maxBytes: 8192 })
    const resized = await sharp(request.data).metadata()
    assert.ok(resized.width <= 32 && resized.height <= 32)
    console.log(`image-smoke: ${format} encode/admit/normalize/store/read/request passed`)
  }
  const oriented = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#123456' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const [ref] = await store.saveImages([{ data: oriented, mediaType: 'image/jpeg' }])
  assert.equal(ref.width, 10)
  assert.equal(ref.height, 20)
  await assert.rejects(() => store.saveImages([{ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }]))
  console.log('image-smoke: EXIF rotation and invalid image rejection passed')
} finally {
  await rm(home, { recursive: true, force: true })
}
