import { diagnostic, type WorkspaceDiagnostic, wholeFile } from '../diagnostics'
import type { GroupedPaths } from '../kind'
import { isResourceKey, RESOURCE_KEY_HINT } from '../layout'

function keyProblem(path: string, key: string): WorkspaceDiagnostic {
  return diagnostic('E_KEY_INVALID', `"${key}" is not a valid key.`, {
    hint: RESOURCE_KEY_HINT,
    span: wholeFile(path),
  })
}

function unknownFile(path: string, expected: string): WorkspaceDiagnostic {
  return diagnostic('E_DECL_UNKNOWN_FILE', `${path} belongs to no resource.`, {
    hint: `This folder holds ${expected}.`,
    span: wholeFile(path),
  })
}

/** A second file a resource may keep beside its declaration, and what it holds (`its code`). */
interface FileCompanion {
  extension: string
  holds: string
}

/**
 * Groups a kind whose resources are files named by key: `<dir>/<key><extension>`, plus the
 * companion file when the kind has one (`tools/<key>.ts` and `tools/<key>.js` group under one key).
 */
export function groupByFile(
  dir: string,
  extension: string,
  paths: readonly string[],
  companion?: FileCompanion
): GroupedPaths {
  const allowed = companion ? [extension, companion.extension] : [extension]
  const groups = new Map<string, string[]>()
  const diagnostics: WorkspaceDiagnostic[] = []
  for (const path of paths) {
    const name = path.slice(dir.length + 1)
    const matched = allowed.find((candidate) => name.endsWith(candidate))
    if (name.includes('/') || matched === undefined) {
      const expected = companion
        ? `one \`<key>${extension}\` per resource, with ${companion.holds} in \`<key>${companion.extension}\``
        : `one \`<key>${extension}\` file per resource`
      diagnostics.push(unknownFile(path, expected))
      continue
    }
    const key = name.slice(0, -matched.length)
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
