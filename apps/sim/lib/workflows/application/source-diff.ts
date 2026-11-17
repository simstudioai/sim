import type { CanonicalDiff, LockIdentity } from '@sim/workflow-code'

interface SourceBlockRef {
  id: string
  key: string
}

/** What the apply changed (or, on a dry run, would change), by stored id and source key. */
export interface SourceDiffSummary {
  noop: boolean
  blocks: {
    added: SourceBlockRef[]
    removed: SourceBlockRef[]
    renamed: Array<{ id: string; from: string; to: string }>
    modified: Array<SourceBlockRef & { fields: string[]; reparented?: boolean }>
  }
  edges: { added: number; removed: number }
  variables: { added: string[]; removed: string[]; modified: string[] }
}

/** The canonical diff by stored id and source key; `noop` is whether the graph is unchanged. */
export function summarizeDiff(
  diff: CanonicalDiff,
  baseIdentity: LockIdentity,
  targetIdentity: LockIdentity,
  noop: boolean
): SourceDiffSummary {
  const targetId = (key: string) => targetIdentity.blocks[key]?.id ?? ''
  const baseId = (key: string) => baseIdentity.blocks[key]?.id ?? ''
  return {
    noop,
    blocks: {
      added: diff.blocks.added.map((key) => ({ id: targetId(key), key })),
      removed: diff.blocks.removed.map((key) => ({ id: baseId(key), key })),
      renamed: diff.blocks.renamed.map(({ from, to }) => ({ id: targetId(to), from, to })),
      modified: diff.blocks.modified.map((change) => {
        const fields = change.changes.map((item) =>
          item.kind === 'param'
            ? item.param
            : item.kind === 'mode'
              ? `modes.${item.canonicalParamId}`
              : item.attribute
        )
        const reparented = change.changes.some(
          (item) => item.kind === 'attribute' && item.attribute === 'parent'
        )
        return {
          id: targetId(change.key),
          key: change.key,
          fields,
          ...(reparented ? { reparented } : {}),
        }
      }),
    },
    edges: { added: diff.edges.added.length, removed: diff.edges.removed.length },
    variables: {
      added: diff.variables.added,
      removed: diff.variables.removed,
      modified: diff.variables.modified,
    },
  }
}

/** The summary of an apply that refused before diffing. */
export function emptyDiffSummary(): SourceDiffSummary {
  return {
    noop: true,
    blocks: { added: [], removed: [], renamed: [], modified: [] },
    edges: { added: 0, removed: 0 },
    variables: { added: [], removed: [], modified: [] },
  }
}
