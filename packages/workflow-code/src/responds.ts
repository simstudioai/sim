/**
 * What a workflow called as a child answers with: whether it always answers with its Response
 * block's output, and how the top-level fields of that output's data are typed.
 */
import {
  alwaysEndsAtResponse,
  isElseConditionTitle,
  RESPONSE_BLOCK_TYPE,
  type ResponseGraphBlock,
} from '@sim/workflow-types/workflow'
import { storedTitle } from './canonicalize/branches'
import type { BlockCatalog } from './catalog/types'
import {
  type ChildResultFields,
  JsonRef,
  type JsonTree,
  parseJsonField,
  type RefTypeScope,
  refValueKind,
} from './json-fields'
import {
  type BlockKey,
  type CanonicalBlock,
  type CanonicalWorkflow,
  isResource,
  type Port,
} from './model'
import { getOwn, setOwn } from './records'

/**
 * The branches `block` always takes one of (as `getAlwaysTakenBranchHandles` reads stored
 * blocks): every route of a router, and a condition's rows up to its first else row (by stored
 * title, as the executor finds it); none for a condition without one or branches never saved.
 */
function alwaysTakenBranches(block: CanonicalBlock): ResponseGraphBlock['branches'] {
  const branches = block.branches
  if (!branches) return undefined
  const rows = branches.rows ?? []
  if (branches.kind === 'router') return rows.map((row) => row.key)
  const elseAt = rows.findIndex((row, index) =>
    isElseConditionTitle(storedTitle(branches.kind, row, index, rows.length))
  )
  return elseAt === -1 ? [] : rows.slice(0, elseAt + 1).map((row) => row.key)
}

function portName(port: Port): string {
  return port.kind === 'branch' ? `branch:${port.key}` : port.kind
}

/**
 * Whether every run of `workflow` ends at an enabled Response block at its root, so a Workflow
 * block calling it reads that block's output, `{ data, status, headers }`, as its `result`
 * ({@link alwaysEndsAtResponse}).
 */
export function respondsOnEveryRun(workflow: CanonicalWorkflow): boolean {
  const blocks: Record<string, ResponseGraphBlock> = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    const branches = alwaysTakenBranches(block)
    setOwn(blocks, key, {
      type: block.type,
      enabled: block.enabled,
      parentId: block.parent,
      ...(branches !== undefined && { branches }),
    })
  }
  return alwaysEndsAtResponse(
    blocks,
    workflow.edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      port: portName(edge.port),
    }))
  )
}

/** How a value at a top-level key of Response data is typed, or `undefined` when nothing says. */
function responseFieldKind(value: JsonTree, scope: RefTypeScope): 'string' | 'typed' | undefined {
  if (value instanceof JsonRef) {
    if (value.quoted) return 'string'
    return refValueKind(value.token, scope) === 'typed' ? 'typed' : undefined
  }
  return typeof value === 'string' ? 'string' : 'typed'
}

/**
 * The top-level fields of the data `workflow` responds with when a Workflow block calls it, each
 * typed as its JSON field stores it: a quoted reference or a string is text, a literal or a
 * reference the workflow types otherwise is typed (a call of its own by `childResults`, the
 * fields of the workflows it calls), and an untyped reference is left out. A field counts only
 * when every enabled Response block holds it typed the same way. `null` when a run can end
 * without responding ({@link respondsOnEveryRun}) or a Response block's data is not a JSON object
 * in the editor's JSON mode (what `response(name, { body: { … } })` stores).
 */
export function childResultFields(
  workflow: CanonicalWorkflow,
  catalog: BlockCatalog,
  childResults?: ReadonlyMap<string, ChildResultFields>
): ChildResultFields | null {
  if (!respondsOnEveryRun(workflow)) return null
  const block = (key: BlockKey) => getOwn(workflow.blocks, key)
  const scope: RefTypeScope = {
    catalog,
    block,
    variable: (key) => getOwn(workflow.variables, key),
    childResult: childResultScope(block, childResults),
  }
  let fields: Map<string, 'string' | 'typed'> | null = null
  for (const block of Object.values(workflow.blocks)) {
    if (block.type !== RESPONSE_BLOCK_TYPE || !block.enabled) continue
    const mode = getOwn(block.params, 'dataMode')
    const data = getOwn(block.params, 'data')
    if (mode?.kind !== 'value' || mode.value !== 'json') return null
    const tree =
      data?.kind === 'value' && typeof data.value === 'string'
        ? parseJsonField(data.value)
        : undefined
    if (!tree || typeof tree !== 'object' || tree instanceof JsonRef || Array.isArray(tree))
      return null
    const own = new Map<string, 'string' | 'typed'>()
    for (const [name, value] of Object.entries(tree)) {
      const kind = responseFieldKind(value, scope)
      if (kind && (fields === null || fields.get(name) === kind)) own.set(name, kind)
    }
    fields = own
  }
  return fields
}

/**
 * The block types that run a workflow as a child. Another block may name a workflow in its
 * `workflowId` (Deployments deploys or promotes one) without calling it.
 */
const CHILD_WORKFLOW_BLOCK_TYPES: ReadonlySet<string> = new Set(['workflow', 'workflow_input'])

/** The key of the workflow `block` runs as a child (its `workflowId` names one), else `null`. */
export function calledWorkflowKey(block: CanonicalBlock): string | null {
  if (!CHILD_WORKFLOW_BLOCK_TYPES.has(block.type)) return null
  const param = getOwn(block.params, 'workflowId')
  const child = param?.kind === 'value' ? param.value : undefined
  return isResource(child, 'workflow') ? child.key : null
}

/** The keys of the workflows `workflow` runs as children, each once, in block order. */
export function calledWorkflowKeys(workflow: CanonicalWorkflow): string[] {
  const keys = new Set<string>()
  for (const block of Object.values(workflow.blocks)) {
    const key = calledWorkflowKey(block)
    if (key !== null) keys.add(key)
  }
  return [...keys]
}

/**
 * The {@link RefTypeScope.childResult} of a workflow whose blocks `block` reads: for a block that
 * runs a child, that child's fields in `childResults` (child workflow key to
 * {@link childResultFields}). Compile and print type `<call.result.data.<field>>` through it alike.
 */
export function childResultScope(
  block: (key: BlockKey) => CanonicalBlock | undefined,
  childResults: ReadonlyMap<string, ChildResultFields> | undefined
): NonNullable<RefTypeScope['childResult']> {
  return (key) => {
    if (!childResults || childResults.size === 0) return undefined
    const called = block(key)
    const child = called ? calledWorkflowKey(called) : null
    return child === null ? undefined : childResults.get(child)
  }
}
