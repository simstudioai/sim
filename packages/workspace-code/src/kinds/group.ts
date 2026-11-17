import { diagnostic, type WorkspaceDiagnostic } from '../diagnostics'
import type { GroupedPaths } from '../kind'
import { isResourceKey } from '../layout'

function keyProblem(path: string, key: string): WorkspaceDiagnostic {
  return diagnostic('E_KEY_INVALID', `"${key}" is not a valid key.`, {
    hint: 'A key is lowercase letters, digits, `-` and `_`, starting with a letter, at most 64 characters.',
    span: { file: path, line: 1, column: 1, endLine: 1, endColumn: 1, start: 0, end: 0 },
  })
}

function unknownFile(path: string, expected: string): WorkspaceDiagnostic {
  return diagnostic('E_DECL_UNKNOWN_FILE', `${path} belongs to no resource.`, {
    hint: `This folder holds ${expected}.`,
    span: { file: path, line: 1, column: 1, endLine: 1, endColumn: 1, start: 0, end: 0 },
  })
}

/**
 * Groups a kind whose resources are files named by key: `<dir>/<key><extension>`, one file per
 * extension (`tools/<key>.ts` and `tools/<key>.js` group under one key).
 */
export function groupByFile(
  dir: string,
  extensions: string | readonly string[],
  paths: readonly string[]
): GroupedPaths {
  const allowed = typeof extensions === 'string' ? [extensions] : extensions
  const groups = new Map<string, string[]>()
  const diagnostics: WorkspaceDiagnostic[] = []
  for (const path of paths) {
    const name = path.slice(dir.length + 1)
    const extension = allowed.find((candidate) => name.endsWith(candidate))
    if (name.includes('/') || extension === undefined) {
      const [primary, ...companions] = allowed.map((candidate) => `\`<key>${candidate}\``)
      const expected = companions.length
        ? `one ${primary} per resource, with its code in ${companions.join(' or ')}`
        : `one ${primary} file per resource`
      diagnostics.push(unknownFile(path, expected))
      continue
    }
    const key = name.slice(0, -extension.length)
    if (!isResourceKey(key)) {
      diagnostics.push(keyProblem(path, key))
      continue
    }
    const group = groups.get(key)
    if (group) group.push(path)
    else groups.set(key, [path])
  }
  return { groups, diagnostics }
}

/** Groups a kind whose resources are one folder each: `<dir>/<key>/…`. */
export function groupByFolder(dir: string, paths: readonly string[]): GroupedPaths {
  const groups = new Map<string, string[]>()
  const diagnostics: WorkspaceDiagnostic[] = []
  for (const path of paths) {
    const rest = path.slice(dir.length + 1)
    const slash = rest.indexOf('/')
    if (slash <= 0) {
      diagnostics.push(unknownFile(path, 'one folder per resource'))
      continue
    }
    const key = rest.slice(0, slash)
    if (!isResourceKey(key)) {
      diagnostics.push(keyProblem(path, key))
      continue
    }
    const group = groups.get(key)
    if (group) group.push(path)
    else groups.set(key, [path])
  }
  return { groups, diagnostics }
}
