import type { CanonicalDiff, CanonicalWorkflow, LockIdentity } from '@sim/workflow-code'

interface SourceBlockRef {
  id: string
  key: string
}

/** An added or removed block, with its type so a reader can spot a probable rename. */
interface TypedSourceBlockRef extends SourceBlockRef {
  type: string
}

/** What the apply changed (or, on a dry run, would change), by stored id and source key. */
export interface SourceDiffSummary {
  noop: boolean
  blocks: {
    added: TypedSourceBlockRef[]
    removed: TypedSourceBlockRef[]
    renamed: Array<{ id: string; from: string; to: string }>
    modified: Array<SourceBlockRef & { fields: string[]; reparented?: boolean }>
  }
  edges: { added: number; removed: number }
  variables: { added: string[]; removed: string[]; modified: string[] }
  /** The workflow's name and description fields the source changes (a stored workflow's). */
  meta?: Array<'name' | 'description'>
}

/**
 * The canonical diff by stored id and source key; `noop` is whether the graph is unchanged and
 * `meta` (the name and description fields the source changes) is empty.
 */
export function summarizeDiff(
  diff: CanonicalDiff,
  base: { workflow: CanonicalWorkflow; identity: LockIdentity },
  target: { workflow: CanonicalWorkflow; identity: LockIdentity },
  noop: boolean,
  meta: ReadonlyArray<'name' | 'description'> = []
): SourceDiffSummary {
  const targetId = (key: string) => target.identity.blocks[key]?.id ?? ''
  const baseId = (key: string) => base.identity.blocks[key]?.id ?? ''
  return {
    noop: noop && meta.length === 0,
    ...(meta.length > 0 ? { meta: [...meta] } : {}),
    blocks: {
      added: diff.blocks.added.map((key) => ({
        id: targetId(key),
        key,
        type: target.workflow.blocks[key]?.type ?? '',
      })),
      removed: diff.blocks.removed.map((key) => ({
        id: baseId(key),
        key,
        type: base.workflow.blocks[key]?.type ?? '',
      })),
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

/**
 * The summary of an apply that refused before diffing: no change is listed, and `noop` is false
 * because a refused source was never found to match the saved draft.
 */
export function emptyDiffSummary(): SourceDiffSummary {
  return {
    noop: false,
    blocks: { added: [], removed: [], renamed: [], modified: [] },
    edges: { added: 0, removed: 0 },
    variables: { added: [], removed: [], modified: [] },
  }
}
