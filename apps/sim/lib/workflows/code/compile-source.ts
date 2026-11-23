import {
  type BlockKey,
  type CanonicalWorkflow,
  type CompileResult,
  compileWorkflow,
  lockIdentRenames,
  setOwn,
  type WorkflowLockV1,
} from '@sim/workflow-code'

type CompileInput = Parameters<typeof compileWorkflow>[0]

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
 * A compile of source against the stored workflow, with `stored` the stored model under the keys
 * this compile read it by: re-keyed by the source's renames, so a caller pairing compiled and
 * stored blocks by key pairs a renamed block with the stored block it continues.
 */
type SourceCompileResult = CompileResult & { stored: CanonicalWorkflow }

/**
 * Compiles source against the stored workflow it continues. Compile finds the stored block a
 * source block continues by key (for `stored()`, the stored-cycle allowance and the stored values
 * of fields source never writes), but a block renamed in source keeps its stored id through its
 * ident (materialize's `lock-ident` rule). When the first pass finds such renames, the stored
 * model is re-keyed to the source's keys and compiled again, so a rename in source continues its
 * block as a rename on the canvas does. The result carries the stored model it compiled against.
 */
export function compileSource(
  input: CompileInput & { stored: CanonicalWorkflow; lock: WorkflowLockV1 }
): SourceCompileResult {
  const { lock, ...compileInput } = input
  const first = compileWorkflow(compileInput)
  const renames = lockIdentRenames(first.hints, lock, (key) =>
    Object.hasOwn(input.stored.blocks, key)
  )
  if (renames.size === 0) return { ...first, stored: input.stored }
  const stored = rekeyStored(input.stored, renames)
  return { ...compileWorkflow({ ...compileInput, stored, renamedKeys: renames }), stored }
}
