const TOOL_SUBBLOCK_INFIX = '-tool-'
const SYNTHETIC_TOOL_SUBBLOCK_RE = new RegExp(`${TOOL_SUBBLOCK_INFIX}\\d+-`)

/**
 * Builds the synthetic subblock id used to render a block-based tool's param
 * inside a tool row.
 *
 * The id follows `{subBlockId}-tool-{index}-{paramId}` and is an ephemeral,
 * client-only projection key for the value held canonically at
 * `tool.params[paramId]` in the aggregate `tool-input` subblock.
 */
export function buildToolSubBlockId(
  aggregateSubBlockId: string,
  toolIndex: number,
  paramId: string
): string {
  return `${aggregateSubBlockId}${TOOL_SUBBLOCK_INFIX}${toolIndex}-${paramId}`
}

/**
 * Returns true for ToolSubBlockRenderer mirror subblocks produced by
 * {@link buildToolSubBlockId}. These duplicate values already stored in the
 * aggregate `tool-input` subblock and must never be persisted or compared.
 */
export function isSyntheticToolSubBlockId(subBlockId: string): boolean {
  return SYNTHETIC_TOOL_SUBBLOCK_RE.test(subBlockId)
}

type ToolParamSyncAction =
  | { action: 'noop' }
  | { action: 'reproject' }
  | { action: 'mirror'; value: string }

/**
 * Reconciles a change to a synthetic tool subblock value with the canonical
 * `tool.params`. The synthetic key is a projection of `tool.params`, so:
 *
 * - `undefined` means the key was dropped by a wholesale store replace — restore
 *   it from `tool.params` ({@link ToolParamSyncAction.action} `reproject`). A
 *   removal is never a user clear.
 * - any defined value (including `''` or `null`, both meaning "cleared by the
 *   user") is a genuine edit to write back (`mirror`).
 * - a value already matching `syncedValue` needs no work (`noop`).
 */
export function resolveToolParamSync(
  storeValue: unknown,
  syncedValue: string | null
): ToolParamSyncAction {
  if (storeValue === undefined) return { action: 'reproject' }

  const stringified =
    storeValue === null
      ? ''
      : typeof storeValue === 'string'
        ? storeValue
        : JSON.stringify(storeValue)

  if (stringified === syncedValue) return { action: 'noop' }
  return { action: 'mirror', value: stringified }
}
