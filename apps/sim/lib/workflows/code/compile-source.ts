import {
  type BlockKey,
  type CanonicalWorkflow,
  type CompileResult,
  compileWorkflow,
  setOwn,
  type WorkflowLockV1,
} from '@sim/workflow-code'

type CompileInput = Parameters<typeof compileWorkflow>[0]

/**
 * Stored keys the source renamed, old → new: a source block under a key the stored workflow lacks
 * whose ident is the one lock entry's, while that entry's stored key is gone from the source.
 * This is materialize's `lock-ident` identity rule, so compile and materialize agree on which
 * stored block a renamed one continues.
 */
function renamedStoredKeys(
  compiled: CompileResult,
  lock: WorkflowLockV1,
  stored: CanonicalWorkflow
): Map<BlockKey, BlockKey> {
  const sourceKeys = new Set(Object.keys(compiled.hints.blocks))
  const vacated = new Map<string, BlockKey[]>()
  for (const [key, entry] of Object.entries(lock.blocks)) {
    if (sourceKeys.has(key) || !Object.hasOwn(stored.blocks, key)) continue
    vacated.set(entry.ident, [...(vacated.get(entry.ident) ?? []), key])
  }
  const renames = new Map<BlockKey, BlockKey>()
  for (const [key, hint] of Object.entries(compiled.hints.blocks)) {
    if (Object.hasOwn(stored.blocks, key) || hint.ident === undefined) continue
    const candidates = vacated.get(hint.ident)
    if (candidates?.length === 1) renames.set(candidates[0], key)
  }
  return renames
}

/** `stored` with each renamed block under its new key, its children and edges following it. */
function rekeyStored(
  stored: CanonicalWorkflow,
  renames: ReadonlyMap<BlockKey, BlockKey>
): CanonicalWorkflow {
  const keyOf = (key: BlockKey) => renames.get(key) ?? key
  const blocks: CanonicalWorkflow['blocks'] = {}
  for (const [key, block] of Object.entries(stored.blocks)) {
    setOwn(blocks, keyOf(key), {
      ...block,
      key: keyOf(key),
      parent: block.parent === null ? null : keyOf(block.parent),
    })
  }
  return {
    ...stored,
    blocks,
    edges: stored.edges.map((edge) => ({ ...edge, from: keyOf(edge.from), to: keyOf(edge.to) })),
  }
}

/**
 * Compiles source against the stored workflow it continues. Compile finds the stored block a
 * source block continues by key (for `stored()`, the stored-cycle allowance and the stored values
 * of fields source never writes), but a block renamed in source keeps its stored id through its
 * ident (materialize's `lock-ident` rule). When the first pass finds such renames, the stored
 * model is re-keyed to the source's keys and compiled again, so a rename in source continues its
 * block as a rename on the canvas does.
 */
export function compileSource(
  input: CompileInput & { stored: CanonicalWorkflow; lock: WorkflowLockV1 }
): CompileResult {
  const { lock, ...compileInput } = input
  const first = compileWorkflow(compileInput)
  const renames = renamedStoredKeys(first, lock, input.stored)
  if (renames.size === 0) return first
  return compileWorkflow({ ...compileInput, stored: rekeyStored(input.stored, renames) })
}
