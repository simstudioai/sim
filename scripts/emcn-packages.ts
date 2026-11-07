import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const MODERN_PACKAGES = ['emcn', 'emcn-auth', 'emcn-docs', 'emcn-platform'] as const

type ExportTarget = string | { types?: string; default?: string; import?: string }
interface PackageManifest {
  exports?: Record<string, ExportTarget>
  imports?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** Workspace source owners, resolved from package exports rather than node_modules links. */
export function emcnPackages(root: string) {
  return MODERN_PACKAGES.map((name) => {
    const directory = path.join(root, 'packages', name)
    const manifestPath = path.join(directory, 'package.json')
    const manifest: PackageManifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : {}
    return { name: `@sim/${name}`, directory, source: path.join(directory, 'src'), manifest }
  })
}

type Packages = ReturnType<typeof emcnPackages>

function resolveTarget(specifier: string, entries: Record<string, ExportTarget>) {
  const keys = Object.keys(entries).sort((left, right) => {
    if (left === specifier) return -1
    if (right === specifier) return 1
    const prefix = right.indexOf('*') - left.indexOf('*')
    return prefix || right.length - left.length
  })
  for (const key of keys) {
    const target = entries[key]
    const star = key.indexOf('*')
    const matches =
      star === -1
        ? key === specifier
        : specifier.startsWith(key.slice(0, star)) && specifier.endsWith(key.slice(star + 1))
    if (!matches) continue
    const value =
      typeof target === 'string' ? target : (target.types ?? target.import ?? target.default)
    if (!value) return null
    return star === -1
      ? value
      : value.replace('*', specifier.slice(star, specifier.length - key.length + star + 1))
  }
  return null
}

/** Resolve public and package-private imports, including wildcard exports, without loading code. */
export function resolveEmcnImport(packages: Packages, specifier: string, from: string) {
  for (const owner of packages) {
    if (specifier.startsWith('#') && from.startsWith(owner.directory + path.sep)) {
      const target = resolveTarget(specifier, owner.manifest.imports ?? {})
      if (target) return path.resolve(owner.directory, target)
    }
    if (specifier === owner.name || specifier.startsWith(`${owner.name}/`)) {
      const subpath = specifier === owner.name ? '.' : `.${specifier.slice(owner.name.length)}`
      const target = resolveTarget(subpath, owner.manifest.exports ?? {})
      return target ? path.resolve(owner.directory, target) : null
    }
  }
  return null
}

/** TypeScript's audit program must resolve temporary checkouts, not the host's installed links. */
export function emcnTypeScriptPaths(packages: Packages) {
  const paths: Record<string, string[]> = {}
  for (const owner of packages) {
    for (const [key, target] of Object.entries(owner.manifest.exports ?? {})) {
      const value =
        typeof target === 'string' ? target : (target.types ?? target.import ?? target.default)
      if (value) {
        const name = key === '.' ? owner.name : `${owner.name}${key.slice(1)}`
        paths[name] = [path.resolve(owner.directory, value)]
      }
    }
    for (const [key, target] of Object.entries(owner.manifest.imports ?? {})) {
      paths[key] = [path.resolve(owner.directory, target)]
    }
  }
  return paths
}
