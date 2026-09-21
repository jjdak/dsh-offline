import { cp, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, parse, sep } from 'node:path'

const [deployedRoot, outputRoot, repositoryRoot] = process.argv.slice(2)
if (!deployedRoot || !outputRoot || !repositoryRoot) {
  throw new Error('usage: materialize-deploy.mjs DEPLOYED_ROOT OUTPUT_ROOT REPOSITORY_ROOT')
}

const sourceNodeModules = join(deployedRoot, 'node_modules')
const outputNodeModules = join(outputRoot, 'node_modules')
const sources = new Map()
const queue = []
const workspaces = new Map()

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function packageRows(nodeModules) {
  const rows = []
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      const scope = join(nodeModules, entry.name)
      for (const child of await readdir(scope, { withFileTypes: true })) {
        rows.push({ name: `${entry.name}/${child.name}`, path: join(scope, child.name) })
      }
    } else {
      rows.push({ name: entry.name, path: join(nodeModules, entry.name) })
    }
  }
  return rows
}

async function indexWorkspaces(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name)
    const manifestPath = join(path, 'package.json')
    if (await exists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string') workspaces.set(manifest.name, path)
    }
    await indexWorkspaces(path)
  }
}

async function remember(name, path) {
  if (sources.has(name)) return
  const source = await realpath(path)
  sources.set(name, source)
  queue.push(name)
}

async function resolveDependency(name, source) {
  const direct = join(sourceNodeModules, name)
  if (await exists(direct)) return realpath(direct)

  let cursor = source
  const root = parse(source).root
  while (cursor !== root) {
    const candidate = join(cursor, 'node_modules', name)
    if (await exists(candidate)) return realpath(candidate)
    cursor = dirname(cursor)
  }
  return workspaces.get(name)
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
await cp(deployedRoot, outputRoot, {
  recursive: true,
  dereference: true,
  filter: path => path !== sourceNodeModules && !path.startsWith(sourceNodeModules + sep),
})
await mkdir(outputNodeModules, { recursive: true })

for (const root of ['apps', 'packages', 'vendor', 'native']) {
  const directory = join(repositoryRoot, root)
  if (await exists(directory)) await indexWorkspaces(directory)
}

for (const row of await packageRows(sourceNodeModules)) await remember(row.name, row.path)

for (let index = 0; index < queue.length; index += 1) {
  const name = queue[index]
  const source = sources.get(name)
  const destination = join(outputNodeModules, name)
  const nestedNodeModules = join(source, 'node_modules')
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
  })

  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const required = Object.keys(manifest.dependencies ?? {})
  const optional = new Set([
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional === true)
      .map(([dependency]) => dependency),
  ])
  const peers = Object.keys(manifest.peerDependencies ?? {})
  for (const dependency of new Set([...required, ...optional, ...peers])) {
    if (sources.has(dependency)) continue
    const resolved = await resolveDependency(dependency, source)
    if (resolved !== undefined) {
      sources.set(dependency, resolved)
      queue.push(dependency)
      continue
    }
    if (required.includes(dependency)) {
      throw new Error(`required dependency ${dependency} of ${name} is absent from the deploy source`)
    }
  }
}

console.log(`materialize-deploy: copied ${sources.size} runtime packages without workspace links`)
