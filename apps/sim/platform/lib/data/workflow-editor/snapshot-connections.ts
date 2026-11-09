import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import { normalizeWorkflowBlockName, type WorkflowState } from '@sim/workflow-types/workflow'

/** One reference a block's configuration makes, with the value it named in the frozen workflow. */
export interface SnapshotReference {
  /** The reference as the configuration writes it, unique within its group. */
  reference: string
  name: string
  value: string
}

/** A block another block's configuration reads, with each path it read and the recorded value. */
interface SnapshotConnection {
  blockId: string
  blockName: string
  fields: SnapshotReference[]
}

interface SnapshotConnections {
  blocks: SnapshotConnection[]
  variables: SnapshotReference[]
  secrets: SnapshotReference[]
}

const VARIABLE_PREFIX = 'variable'

/** A value on one line: text as written, anything else as compact JSON. */
function inlineValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Reads `a.b[0].c` from a recorded output. The executor's own navigator materializes large-value
 * references on the server; a frozen output is read only as it was recorded.
 */
function readRecordedPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const part of path) {
    const match = /^([^[]*)((?:\[\d+\])*)$/.exec(part)
    const key = match ? match[1] : part
    const indexes = match ? (match[2].match(/\d+/g) ?? []) : []
    if (key) {
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[key]
          : undefined
    }
    for (const index of indexes) {
      current = Array.isArray(current) ? current[Number(index)] : undefined
    }
    if (current === undefined) return undefined
  }
  return current
}

/** Every `<block.path>`, `<variable.name>` and `{{SECRET}}` a block's stored values name, once each. */
function collectReferences(values: Readonly<Record<string, unknown>>) {
  const workflow = new Set<string>()
  const secrets = new Set<string>()
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const token of findWorkflowReferenceTokens(value)) {
        if (token.kind === 'environment') secrets.add(token.value)
        else workflow.add(token.value)
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (typeof value === 'object' && value !== null) {
      if ('value' in value) visit(value.value)
      else Object.values(value).forEach(visit)
    }
  }
  Object.values(values).forEach(visit)
  return { workflow: [...workflow], secrets: [...secrets] }
}

/**
 * What a frozen block's configuration reads, as legacy's preview editor lists it: each block it
 * references with the value that block recorded, the workflow variables it names with their frozen
 * values, and the secrets it names, whose values never leave the server. A block with no recorded
 * output (a version that never ran, or a block the run skipped) contributes nothing.
 */
export function resolveSnapshotConnections(
  subBlocks: Readonly<Record<string, unknown>>,
  workflowState: WorkflowState,
  outputs: ReadonlyMap<string, { output?: unknown }>
): SnapshotConnections {
  const references = collectReferences(subBlocks)
  const blockIdByName = new Map<string, string>()
  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    if (block.name) blockIdByName.set(normalizeWorkflowBlockName(block.name), blockId)
  }
  const variables = Object.values(workflowState.variables ?? {})

  const connections = new Map<string, SnapshotConnection>()
  const variableRefs: SnapshotReference[] = []
  for (const reference of references.workflow) {
    const [prefix = '', ...path] = reference.slice(1, -1).split('.')
    if (normalizeWorkflowBlockName(prefix) === VARIABLE_PREFIX) {
      const name = path.join('.')
      const variable = variables.find(
        (entry) => normalizeWorkflowBlockName(entry.name) === normalizeWorkflowBlockName(name)
      )
      variableRefs.push({
        reference,
        name,
        value: variable ? inlineValue(variable.value) : 'Not defined',
      })
      continue
    }
    const blockId = blockIdByName.get(normalizeWorkflowBlockName(prefix))
    const block = blockId ? workflowState.blocks[blockId] : undefined
    const output = blockId ? outputs.get(blockId)?.output : undefined
    if (!blockId || !block || output === undefined) continue
    const value = path.length === 0 ? output : readRecordedPath(output, path)
    if (value === undefined) continue
    const connection = connections.get(blockId) ?? {
      blockId,
      blockName: block.name || prefix,
      fields: [],
    }
    connection.fields.push({
      reference,
      name: path.join('.') || 'output',
      value: inlineValue(value),
    })
    connections.set(blockId, connection)
  }

  return {
    blocks: [...connections.values()],
    variables: variableRefs,
    secrets: references.secrets.map((reference) => ({
      reference,
      name: reference.slice(2, -2).trim(),
      value: 'Redacted',
    })),
  }
}
