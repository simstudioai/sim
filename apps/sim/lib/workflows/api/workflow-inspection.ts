import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type {
  V2InspectWorkflowQuery,
  V2WorkflowInspection,
} from '@/lib/api/contracts/v2/workflow-inspection'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isSensitiveKey,
  REDACTED_MARKER,
  redactSensitiveValues,
  TRUNCATED_MARKER,
} from '@/lib/core/security/redaction'
import type { ReadWorkflowGraphResult } from '@/lib/workflows/application/read-workflow-graph'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
import { getBlock } from '@/blocks/registry'

/** A diagnostic projection; never an editable or portable workflow representation. */
export function presentWorkflowInspection(
  graph: ReadWorkflowGraphResult,
  query: V2InspectWorkflowQuery
): V2WorkflowInspection {
  if (query.blockId && !Object.hasOwn(graph.blocks, query.blockId)) {
    throw new OrchestrationError('not_found', 'Block not found in workflow')
  }
  const selected = query.blockId ? { [query.blockId]: graph.blocks[query.blockId] } : graph.blocks
  const sanitized = sanitizeWorkflowForSharing(
    { blocks: selected },
    {
      preserveEnvVars: true,
      preserveWorkspaceBindings: true,
      preserveReferenceMetadata: true,
      redactOpaqueCredentialInputs: true,
    }
  )
  let remainingCharacters = 64 * 1024
  let remainingValues = 2000
  let truncated = false

  function projectString(value: string): string | undefined {
    const limit = Math.min(4096, remainingCharacters)
    if (limit < TRUNCATED_MARKER.length) {
      truncated = true
      return undefined
    }
    const result =
      value.length <= limit
        ? value
        : truncate(value, limit - TRUNCATED_MARKER.length, TRUNCATED_MARKER)
    remainingCharacters -= result.length
    if (result !== value) truncated = true
    return result
  }

  function reserveKey(key: string): boolean {
    if (key.length > 256 || key.length > remainingCharacters) {
      truncated = true
      return false
    }
    remainingCharacters -= key.length
    return true
  }

  function project(value: unknown, depth = 0): unknown {
    if (remainingValues <= 0 || remainingCharacters <= 0) {
      truncated = true
      return undefined
    }
    remainingValues--
    if (depth > 6) {
      truncated = true
      return projectString(TRUNCATED_MARKER)
    }
    if (typeof value === 'string') {
      return projectString(redactSensitiveValues(value))
    }
    if (Array.isArray(value)) {
      if (value.length > 50) truncated = true
      const result: unknown[] = []
      for (const item of value.slice(0, 50)) {
        const projected = project(item, depth + 1)
        if (projected === undefined) break
        result.push(projected)
      }
      return result
    }
    if (isRecordLike(value)) {
      const entries = Object.entries(value)
      if (entries.length > 50) truncated = true
      const result: [string, unknown][] = []
      for (const [key, item] of entries.slice(0, 50)) {
        if (!reserveKey(key)) continue
        const projected = project(isSensitiveKey(key) ? REDACTED_MARKER : item, depth + 1)
        if (projected === undefined) break
        result.push([key, projected])
      }
      return Object.fromEntries(result)
    }
    return value
  }

  const blocks = Object.entries(selected).map(([id, block]) => {
    const inputs: Record<string, unknown> = {}
    const omittedInputs: string[] = []
    const definitions = new Map(
      (getBlock(block.type)?.subBlocks ?? []).map((field) => [field.id, field])
    )
    for (const [key, field] of Object.entries(block.subBlocks)) {
      if (field.value === null || field.value === undefined || field.value === '') continue
      const definition = definitions.get(key)
      const value = sanitized.blocks?.[id]?.subBlocks?.[key]?.value
      if (
        !definition ||
        definition.hideFromCopilot ||
        value == null ||
        (!query.includeCode &&
          (definition.type === 'code' ||
            definition.type === 'tool-input' ||
            field.type === 'code' ||
            key === 'code' ||
            field.type === 'tool-input'))
      ) {
        omittedInputs.push(key)
        continue
      }
      if (!reserveKey(key)) {
        omittedInputs.push(key)
        continue
      }
      const projected = project(isSensitiveKey(key) ? REDACTED_MARKER : value)
      if (projected === undefined) omittedInputs.push(key)
      else inputs[key] = projected
    }
    return {
      id,
      name: block.name,
      type: block.type,
      enabled: block.enabled !== false,
      parentId: block.data?.parentId ?? null,
      inputs,
      omittedInputs,
    }
  })
  return {
    representation: 'diagnostic',
    workflowId: graph.workflowId,
    workspaceId: graph.workspaceId,
    blocks,
    edges: graph.edges
      .filter(
        (edge) => !query.blockId || edge.source === query.blockId || edge.target === query.blockId
      )
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
    truncated,
    notes: [
      'Diagnostic draft view only. Use Get Workflow State for an editable round trip; never write this representation back.',
      'Credential fields and opaque credential-bearing inputs are withheld. Automatic redaction cannot identify every secret in arbitrary text or code.',
      'Inputs are bounded to 4096 characters per string, 256 characters per key, 50 entries per container, six nested levels, and shared budgets of 65536 string/key characters and 2000 values. Use blockId to focus the budget.',
    ],
  }
}
