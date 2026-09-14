import { posix } from 'node:path'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { registry } from '#design-conformance/contracts'
import {
  type Change,
  canonical,
  type Entry,
  type Facts,
  type Finding,
  hash,
  type Note,
  scope,
} from '#design-conformance/model'

/** Explicit ownership applies before the legacy media exclusions, only in conformance mode. */
export function artworkFile(file: string): boolean {
  return (
    !registry.artwork?.brandAssets?.[file] &&
    !!registry.artwork?.libraries.some((root) => file.startsWith(root)) &&
    /\.(?:[cm]?[jt]sx?|css|svg|png|jpe?g|webp|avif|gif)$/.test(file) &&
    !/\.(?:test|spec|generated|d)\.|(?:^|\/)(?:node_modules|dist|build|__tests__|__fixtures__|fixtures)\//.test(
      file
    )
  )
}

/** Apply reviewed product/landing ownership without changing legacy scope. */
export function conformanceScope(file: string): ReturnType<typeof scope> {
  if (registry.ownership?.[file]?.scope === 'landing') return 'exclude'
  if (registry.artwork?.brandAssets?.[file]) return 'exclude'
  if (registry.artwork?.brandingFiles.includes(file)) return 'exclude'
  if (artworkFile(file)) return 'check'
  /** Product-local icon/illustration source is no longer a blanket styling exemption. */
  return scope(file.replace(/\/(?:icons?|iso)(?=\/|\.)/g, '/artwork-content'))
}

/** Remove parser metadata and formatting; do not evaluate an asset's source. */
export function artworkSyntax(node: t.Node): string {
  return JSON.stringify(node, function (key, value) {
    if (
      [
        'start',
        'end',
        'loc',
        'extra',
        'leadingComments',
        'trailingComments',
        'innerComments',
        'comments',
        'tokens',
      ].includes(key)
    )
      return undefined
    if (key === 'value' && this && (this as { type?: string }).type === 'JSXText')
      return String(value).trim().replace(/\s+/g, ' ')
    if (key === 'children' && Array.isArray(value))
      return value.filter(
        (v) =>
          !(v.type === 'JSXText' && !v.value.trim()) &&
          !(v.type === 'JSXExpressionContainer' && v.expression.type === 'JSXEmptyExpression')
      )
    return value
  })
}

const authority = 'scripts/design-conformance/contracts.json#artwork'
function finding(
  file: string,
  input: string,
  value: string,
  central: boolean,
  before?: string
): Finding {
  return {
    kind: central ? 'system-change' : 'usage-violation',
    contract: 'central-artwork',
    rule: 'central-artwork',
    category: 'artwork',
    property: 'artwork',
    file,
    line: 1,
    column: 1,
    context: 'artwork',
    value,
    ...(before ? { before } : {}),
    reason: central
      ? 'Central artwork definition changed; review the shared asset, including intentional improvements'
      : 'Product artwork is authored locally; reuse a central asset or introduce it through the central artwork library',
    provenance: {
      source: authority,
      input,
      permitted: registry.artwork?.permission ?? 'Reuse central artwork',
    },
  }
}

/** Asset blobs are compared directly; raster media is never decoded or executed. */
export function artworkDiff(
  change: Change,
  read: (entry: Entry) => string
): { findings: Finding[]; unchecked: Note[] } {
  const file = (change.after ?? change.before)!.path
  const unchecked: Note[] = []
  const identity = (entry: Entry | null): string | undefined => {
    if (!entry) return undefined
    if (!/^[a-f\d]{40}$/.test(entry.blob)) throw new Error('Invalid artwork blob identity')
    if (!/^100(?:644|755)$/.test(entry.mode)) {
      unchecked.push({
        line: 1,
        context: 'artwork',
        reason: 'Artwork symlink/submodule is not followed',
      })
      return undefined
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.path)) return entry.blob
    const source = read(entry)
    if (Buffer.byteLength(source) > registry.limits.sourceBytes) {
      unchecked.push({
        line: 1,
        context: 'artwork',
        reason: 'Artwork source exceeds the 2 MiB parsing limit; only blob change is known',
      })
      return entry.blob
    }
    try {
      const program = parse(source, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      }).program
      /**
       * A direct export of explicitly sanctioned provider artwork does not change
       * the product artwork library. This exemption never depends on a name match.
       */
      program.body = program.body.filter((node) => {
        if (!t.isExportNamedDeclaration(node) || !node.source?.value.startsWith('.')) return true
        const target = posix.normalize(posix.join(posix.dirname(entry.path), node.source.value))
        return ![target, `${target}.tsx`, `${target}.ts`].some(
          (p) => registry.artwork?.brandAssets?.[p]
        )
      })
      if (!program.body.length && !program.directives.length) return undefined
      return hash(artworkSyntax(program))
    } catch {
      unchecked.push({
        line: 1,
        context: 'artwork',
        reason: 'Artwork parser failure; only blob change is known',
      })
      return entry.blob
    }
  }
  const before = identity(change.before)
  const after = identity(change.after)
  return {
    findings:
      before === after
        ? []
        : [
            finding(
              file,
              `asset ${file}; Git blob ${change.before?.blob ?? '(absent)'} → ${change.after?.blob ?? '(removed)'}`,
              after ?? '(removed)',
              true,
              before
            ),
          ],
    unchecked,
  }
}

/** Compare authored SVG occurrences, retaining untouched debt within its existing owner. */
export function localArtworkDiff(
  before: Facts,
  after: Facts,
  change: Change,
  central = false
): Finding[] {
  const counts = new Map<string, number>()
  if (change.before?.path === change.after?.path)
    for (const a of before.artwork ?? []) {
      const key = canonical([a.context, a.value])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  const findings = (after.artwork ?? []).flatMap((a) => {
    const key = canonical([a.context, a.value])
    const count = counts.get(key) ?? 0
    if (count) {
      counts.set(key, count - 1)
      return []
    }
    return [
      {
        ...finding(change.after!.path, a.input, a.value, central),
        line: a.line,
        column: a.column,
        context: a.context,
      },
    ]
  })
  if (central && !after.unchecked.length) {
    for (const a of before.artwork ?? []) {
      const key = canonical([a.context, a.value])
      const count = counts.get(key) ?? 0
      if (!count) continue
      counts.set(key, count - 1)
      const replacement = findings.find((f) => f.context === a.context && !f.before)
      if (replacement) replacement.before = a.value
      else
        findings.push({
          ...finding((change.after ?? change.before)!.path, a.input, '(removed)', true, a.value),
          line: a.line,
          column: a.column,
          context: a.context,
        })
    }
  }
  return findings
}
