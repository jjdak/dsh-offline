import { execFileSync } from 'node:child_process'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [app] = process.argv.slice(2)
if (!app) throw new Error('usage: stage-koffi.mjs APP')
const modules = join(app, 'node_modules')
const koffi = join(modules, 'koffi')
const manifest = JSON.parse(await readFile(join(koffi, 'package.json'), 'utf8'))
if (manifest.version !== '3.1.1') throw new Error(`Review Koffi compatibility for ${manifest.version}`)
const builder = join(koffi, 'cnoke.cjs')
const original = await readFile(builder, 'utf8')
if (!original.includes('-march=x86-64')) throw new Error('Koffi CPU build flags changed')
// GCC 10 in manylinux2014 predates the x86-64-v2 spelling; build the baseline ISA.
await writeFile(builder, original.replaceAll('-march=x86-64-v2', '-march=x86-64'))
const basePath = join(koffi, 'lib/native/base/base.cc')
const base = await readFile(basePath, 'utf8')
const statBranch = 'static StatResult StatAt(int fd, bool fd_is_directory, const char *filename, unsigned int flags, FileInfo *out_info)\n{\n#if defined(__linux__)'
if (!base.includes(statBranch)) throw new Error('Koffi StatAt implementation changed')
// Use Koffi's existing fstat/fstatat path: statx needs glibc 2.28 and a newer kernel.
await writeFile(basePath, base.replace(statBranch, statBranch.replace('#if defined(__linux__)', '#if 0 // offline glibc217: use the POSIX fallback')))
await rm(join(koffi, 'build'), { recursive: true, force: true })
execFileSync(process.execPath, [builder, '-P', '.', '-D', 'src/koffi', '--release'], {
  cwd: koffi,
  env: { ...process.env, LDFLAGS: '-static-libstdc++ -static-libgcc', MAKEFLAGS: '-j4', CMAKE_BUILD_PARALLEL_LEVEL: '4' },
  stdio: 'inherit',
})
// Force use of the locally built binding, never an incompatible optional prebuild.
const scope = join(modules, '@koromix')
for (const name of await readdir(scope).catch(error => {
  if (error.code === 'ENOENT') return []
  throw error
})) {
  if (name.startsWith('koffi-')) await rm(join(scope, name), { recursive: true, force: true })
}
execFileSync(process.execPath, ['-e', 'const k = require(process.argv[1]); const getpid = k.load(null).func("int getpid(void)"); if (getpid() !== process.pid) throw Error("Koffi libc call failed")', koffi], { stdio: 'inherit' })
await rm(join(koffi, 'build/koffi/linux_x64', `v${process.versions.node}_native`), { recursive: true, force: true })
console.log('stage-koffi: glibc217 source build and libc FFI call passed')
