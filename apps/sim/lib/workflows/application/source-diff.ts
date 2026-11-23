import {
  type CanonicalDiff,
  type CanonicalWorkflow,
  getOwn,
  type LockIdentity,
} from '@sim/workflow-code'
import { isEqual } from 'es-toolkit'

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
  variables: {
    added: string[]
    removed: string[]
    /** Keys renamed with their id kept (an inferred lone rename), not added and removed. */
    renamed: Array<{ from: string; to: string }>
    modified: string[]
  }
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
    variables: variableChanges(diff, base, target),
  }
}

/**
 * The variable changes, a removed key whose id an added key kept reported as a rename: the apply
 * keeps that variable, so it is neither deleted nor needs `allowDelete`. A renamed variable whose
 * type or value also changed is listed under `modified` too, by its new key.
 */
function variableChanges(
  diff: CanonicalDiff,
  base: { workflow: CanonicalWorkflow; identity: LockIdentity },
  target: { workflow: CanonicalWorkflow; identity: LockIdentity }
): SourceDiffSummary['variables'] {
  const addedById = new Map(
    diff.variables.added.flatMap((key) => {
      const id = getOwn(target.identity.variables, key)
      return id === undefined ? [] : [[id, key] as const]
    })
  )
  const renamed = diff.variables.removed.flatMap((from) => {
    const id = getOwn(base.identity.variables, from)
    const to = id === undefined ? undefined : addedById.get(id)
    return to === undefined ? [] : [{ from, to }]
  })
  const moved = new Set(renamed.flatMap(({ from, to }) => [from, to]))
  const rewritten = renamed.flatMap(({ from, to }) => {
    const before = getOwn(base.workflow.variables, from)
    const after = getOwn(target.workflow.variables, to)
    return before?.type === after?.type && isEqual(before?.value, after?.value) ? [] : [to]
  })
  return {
    added: diff.variables.added.filter((key) => !moved.has(key)),
    removed: diff.variables.removed.filter((key) => !moved.has(key)),
    renamed,
    modified: [...diff.variables.modified, ...rewritten],
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
    variables: { added: [], removed: [], renamed: [], modified: [] },
  }
}
