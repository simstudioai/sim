import type { BlockConfig } from '@/blocks/types'

/**
 * The subblock id that carries a block's operation.
 *
 * Singular only. Four blocks (`elasticsearch`, `mailchimp`, `onepassword`,
 * `typeform`) also declare an `operations` subblock, but it holds a JSON-patch
 * payload rather than an operation selector — matching it could only ever key
 * a gate off the wrong value.
 */
export const OPERATION_SUBBLOCK_ID = 'operation'

export const MODEL_SUBBLOCK_ID = 'model'

/** Shared empty result, so a caller's memo sees a stable identity. */
export const NO_DENIED_OPERATIONS: ReadonlySet<string> = new Set()

/** The slice of a block config the operation gate reads. */
export type OperationGateBlock = Pick<BlockConfig, 'tools'>

/** Decides whether the caller's permission group allows a concrete tool id. */
export type IsToolAllowed = (toolId: string) => boolean

/**
 * Vetoes a subblock's declared default when the caller's permission group does
 * not allow it — or when the group config is not known yet, since a default
 * written during block creation is never revisited.
 */
export type SeedValueGate = (subBlockId: string, value: string) => boolean

/**
 * The tool id a block operation maps to, or `null` when it cannot be resolved
 * from the operation alone.
 *
 * Deliberately not `getToolIdForOperation` from `@/tools/params`: that one ends
 * with an unconditional `access[0]` fallback, which for a gate would authorize
 * an unrecognized operation against a tool it has nothing to do with. It also
 * logs on every selector throw, and this runs once per option of every block
 * offered.
 *
 * Never guesses. A selector that also reads sibling fields throws when handed
 * an operation on its own, and an operation the block does not recognize has
 * no tool — both yield `null`, which callers read as "not gateable here". The
 * server-side gate in `assertPermissionsAllowed` stays authoritative either
 * way, so a `null` only ever costs a denied option staying visible, never a
 * permitted option disappearing.
 */
function resolveOperationToolId(
  block: OperationGateBlock | null | undefined,
  operationId: string
): string | null {
  const access = block?.tools?.access
  if (!access || access.length === 0) return null

  /* One tool means there is nothing to select: the block runs that tool
     whatever its operation dropdown says. */
  if (access.length === 1) return access[0]

  const selectTool = block?.tools?.config?.tool
  if (selectTool) {
    try {
      const toolId = selectTool({ operation: operationId })
      if (toolId) return toolId
    } catch {
      /* Unresolvable from the operation alone; see the TSDoc above. */
    }
  }

  /* Blocks with no selector list their tool ids as their operation ids. */
  return access.includes(operationId) ? operationId : null
}

/** Whether the caller's permission group allows a block operation. */
export function isOperationAllowed(
  block: OperationGateBlock | null | undefined,
  operationId: string,
  isToolAllowed: IsToolAllowed
): boolean {
  const toolId = resolveOperationToolId(block, operationId)
  if (!toolId) return true
  return isToolAllowed(toolId)
}

/**
 * The operation ids of `block` whose tool the caller's permission group denies.
 *
 * Denied operations are hidden from pickers rather than removed from the model,
 * so a workflow that already references one keeps resolving its label.
 */
export function collectDeniedOperationIds(
  block: OperationGateBlock | null | undefined,
  operationIds: Iterable<string>,
  isToolAllowed: IsToolAllowed
): ReadonlySet<string> {
  const denied = new Set<string>()
  for (const operationId of operationIds) {
    if (!isOperationAllowed(block, operationId, isToolAllowed)) {
      denied.add(operationId)
    }
  }
  return denied
}

/**
 * The operation an unset field should be seeded with: `preferred` when the
 * group allows it, otherwise the first candidate it does allow.
 *
 * Returns `undefined` when every candidate is denied. `useOperationAccess`
 * additionally returns `undefined` while the permission config is loading, so a
 * caller that seeds only on a defined value can never persist a denied default.
 */
export function pickDefaultOperation(
  block: OperationGateBlock | null | undefined,
  candidates: Iterable<string>,
  isToolAllowed: IsToolAllowed,
  preferred?: string
): string | undefined {
  if (preferred !== undefined && isOperationAllowed(block, preferred, isToolAllowed)) {
    return preferred
  }

  for (const candidate of candidates) {
    if (isOperationAllowed(block, candidate, isToolAllowed)) return candidate
  }

  return undefined
}
