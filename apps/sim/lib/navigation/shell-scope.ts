/**
 * The product shell is one instance in the product root layout, which Next renders without the
 * route's params. The proxy names the resource a request opens in this header, and the layout
 * reads it to decide which organization's shell to render. Dependency-free so the edge proxy and
 * server components read the same values.
 */
export const SHELL_SCOPE_HEADER = 'x-sim-shell-scope'

/**
 * The path and query a document request opens, set by the proxy alongside the scope. The shell's
 * gates read it to answer an entry page's redirect before anything streams, as the legacy layout's
 * page did.
 */
export const SHELL_PATH_HEADER = 'x-sim-shell-path'

export type ShellScope =
  | { kind: 'organization'; organizationId: string }
  | { kind: 'workspace'; workspaceId: string }

const SCOPED_ROOTS = [
  { root: 'o', prefix: 'org' },
  { root: 'workspace', prefix: 'workspace' },
] as const

/** The header value for `pathname`: `org:<id>` under `/o/<id>`, `workspace:<id>` under `/workspace/<id>`. */
export function shellScopeHeaderValue(pathname: string): string | null {
  const [, root, id] = pathname.split('/')
  const scoped = SCOPED_ROOTS.find((entry) => entry.root === root)
  return scoped && id ? `${scoped.prefix}:${id}` : null
}

/** The scope a header value names, or `null` for a request outside an organization or workspace. */
export function parseShellScope(value: string | null): ShellScope | null {
  const match = value?.match(/^(org|workspace):(.+)$/)
  if (!match) return null
  const id = decodeURIComponent(match[2])
  return match[1] === 'org'
    ? { kind: 'organization', organizationId: id }
    : { kind: 'workspace', workspaceId: id }
}
