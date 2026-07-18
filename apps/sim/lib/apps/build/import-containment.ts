import { dirname, resolve, sep } from 'node:path'

/** Strip Vite/query/hash suffixes from a module id or resolved path. */
export function stripImportQuery(id: string): string {
  const hash = id.indexOf('#')
  const withoutHash = hash >= 0 ? id.slice(0, hash) : id
  const q = withoutHash.indexOf('?')
  return q >= 0 ? withoutHash.slice(0, q) : withoutHash
}

export function pathIsInsideRoot(absolutePath: string, root: string): boolean {
  const normalized = resolve(absolutePath)
  const normalizedRoot = resolve(root)
  return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + sep)
}

/**
 * Resolve a relative/absolute import against an importer and check sandbox roots.
 * Bare package ids return `{ kind: 'bare' }` — caller applies the curated allowlist.
 */
export function classifyResolvedImport(params: {
  id: string
  importer: string | undefined
  projectRoot: string
  allowedRoots: string[]
}):
  | { kind: 'virtual' }
  | { kind: 'bare'; id: string }
  | { kind: 'allowed'; resolvedPath: string }
  | { kind: 'rejected'; reason: string } {
  const { id, importer, projectRoot, allowedRoots } = params
  if (!id || id.startsWith('\0')) return { kind: 'virtual' }

  const bareId = stripImportQuery(id)
  const isRelative = bareId.startsWith('.')
  const isAbsolute = bareId.startsWith('/') || /^[A-Za-z]:[\\/]/.test(bareId)

  if (!isRelative && !isAbsolute) {
    return { kind: 'bare', id: bareId }
  }

  const base = importer ? dirname(stripImportQuery(importer)) : projectRoot
  const resolvedPath = resolve(base, bareId)

  if (resolvedPath.includes(`${sep}node_modules${sep}`) || resolvedPath.endsWith(`${sep}node_modules`)) {
    // Allow only when the path sits inside an explicit curated package root
    // (those roots themselves live under host node_modules).
    const inCuratedPackage = allowedRoots.some(
      (root) =>
        root.includes(`${sep}node_modules${sep}`) && pathIsInsideRoot(resolvedPath, root)
    )
    if (!inCuratedPackage) {
      return {
        kind: 'rejected',
        reason: `Import escapes build sandbox: ${id}`,
      }
    }
  }

  if (!allowedRoots.some((root) => pathIsInsideRoot(resolvedPath, root))) {
    return {
      kind: 'rejected',
      reason: `Import escapes build sandbox: ${id}`,
    }
  }

  return { kind: 'allowed', resolvedPath }
}

/** Pure check used by unit tests and mirrored in the generated Vite plugin. */
export function assertImportAllowed(params: {
  id: string
  importer: string | undefined
  projectRoot: string
  allowedRoots: string[]
  allowedBare: ReadonlySet<string>
}): { ok: true } | { ok: false; reason: string } {
  const classified = classifyResolvedImport(params)
  if (classified.kind === 'virtual' || classified.kind === 'allowed') return { ok: true }
  if (classified.kind === 'rejected') return { ok: false, reason: classified.reason }

  const bare = classified.id
  if (bare.startsWith('node:')) {
    return { ok: false, reason: `Disallowed import "${bare}" — curated app deps only` }
  }
  if (params.allowedBare.has(bare)) return { ok: true }
  const root = bare.startsWith('@') ? bare.split('/').slice(0, 2).join('/') : bare.split('/')[0]
  if (params.allowedBare.has(root)) return { ok: true }
  return {
    ok: false,
    reason: `Disallowed import "${bare}". Local app builds may only import: ${[...params.allowedBare].join(', ')}`,
  }
}
