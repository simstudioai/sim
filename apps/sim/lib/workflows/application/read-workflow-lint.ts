import type { Principal } from '@sim/auth/principal'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import type { CursorKey } from '@/lib/api/list-query'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { listAvailableCustomToolsUseCase } from '@/lib/custom-tools/application/use-cases'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { getMcpServerUseCase } from '@/lib/mcp/application/use-cases'
import { listSecretsUseCase } from '@/lib/secrets/application/use-cases'
import { getSkillUseCase } from '@/lib/skills/application/use-cases'
import { readTableDefinitionUseCase } from '@/lib/table/application/tables'
import { buildIdByName, buildNameById, unknownColumnNames } from '@/lib/table/column-keys'
import {
  collectPredicateFieldNames,
  collectSortFieldNames,
} from '@/lib/table/query-builder/field-names'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  loadWorkflowGraph,
  type ReadWorkflowGraphInput,
  type ReadWorkflowGraphResult,
  readWorkflowGraph,
} from '@/lib/workflows/application/read-workflow-graph'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import {
  buildWorkflowLintReport,
  type WorkflowLintTableDiagnostics,
} from '@/lib/workflows/editing/lint-report'
import { validateSelectorIds } from '@/lib/workflows/editing/selector-validator'
import { buildSelectorContextFromBlock } from '@/lib/workflows/subblocks/context'
import { getBlock } from '@/blocks/registry'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import { extractBlockParams } from '@/serializer/index'

interface ReadWorkflowLintInput extends ReadWorkflowGraphInput {
  signal?: AbortSignal
}

export interface WorkflowLintDiagnostic extends WorkflowLintReport {
  undeclaredEnvVars: { name: string; blocks: string[] }[]
}

/** Standalone diagnostics bind all lookups to the canonical workflow and the authenticated actor. */
export const readWorkflowLint = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readLint,
  resolveContext: ({ input }: { input: ReadWorkflowLintInput }) => {
    input.signal?.throwIfAborted()
    return resolveActiveWorkflowApplicationContext(input)
  },
  async execute({ principal, context, input, request }): Promise<WorkflowLintDiagnostic> {
    input.signal?.throwIfAborted()
    const graph = await loadWorkflowGraph(context)
    input.signal?.throwIfAborted()
    const referenceNotes = new Set<string>()
    let customToolIds: Set<string> | undefined
    const tables = await readTableDiagnostics(graph, principal, input.signal, request)
    const report = await buildWorkflowLintReport(
      graph,
      {
        workflowId: graph.workflowId,
        workspaceId: graph.workspaceId,
        subjectUserId: principal.userId,
      },
      {
        requireComplete: true,
        tables,
        async resolveAgentTool(reference) {
          input.signal?.throwIfAborted()
          if (hasRuntimeReference(reference.value)) {
            referenceNotes.add(
              `Agent references in block "${reference.blockName || reference.blockId}" require runtime resolution and were not checked.`
            )
            return undefined
          }
          const { kind, value } = reference
          const missing =
            kind === 'custom-tool'
              ? `Custom tool "${value}" is not available to this actor in this workspace. Inspect custom-tools list and attach an available tool ID or an inline definition.`
              : kind === 'skill'
                ? `Skill "${value}" is not an accessible builtin or workspace skill. Inspect skills list for available IDs.`
                : `MCP server "${value}" does not resolve to an accessible, enabled server in this workspace.`
          try {
            if (kind === 'custom-tool') {
              if (!customToolIds) {
                const { tools } = await listAvailableCustomToolsUseCase.execute({
                  principal,
                  input: { workspaceId: graph.workspaceId },
                  request,
                })
                customToolIds = new Set(tools.map((tool) => tool.id))
              }
              input.signal?.throwIfAborted()
              return customToolIds.has(value) ? undefined : missing
            }
            if (kind === 'skill') {
              await getSkillUseCase.execute({
                principal,
                input: { workspaceId: graph.workspaceId, skillId: value },
                request,
              })
              input.signal?.throwIfAborted()
              return undefined
            }
            const { server } = await getMcpServerUseCase.execute({
              principal,
              input: { workspaceId: graph.workspaceId, serverId: value },
              request,
            })
            input.signal?.throwIfAborted()
            if (!server.enabled) return missing
            referenceNotes.add(
              'MCP checks cover saved server access and enabled state; live connectivity and tool availability were not checked.'
            )
            return undefined
          } catch (error) {
            if (
              !(error instanceof OrchestrationError) ||
              (error.code !== 'not_found' && error.code !== 'forbidden')
            )
              throw error
            return missing
          }
        },
        async resolveSelector(reference) {
          input.signal?.throwIfAborted()
          const ids = (Array.isArray(reference.value) ? reference.value : [reference.value]).filter(
            (id) => {
              if (!id || id.trim() === '') return false
              if (!hasRuntimeReference(id)) return true
              referenceNotes.add(
                `Runtime values in reference field "${reference.fieldName}" in block "${reference.blockName || reference.blockId}" were not checked.`
              )
              return false
            }
          )
          if (ids.length === 0) return { valid: [], invalid: [] }
          const isDocument = reference.selectorType === 'document-selector'
          if (reference.selectorType !== 'workflow-selector' && !isDocument) {
            return validateSelectorIds(
              reference.selectorType,
              ids,
              {
                userId: principal.userId,
                workspaceId: graph.workspaceId,
              },
              { requireComplete: true }
            )
          }
          const block = graph.blocks[reference.blockId]
          const knowledgeBaseId = isDocument
            ? buildSelectorContextFromBlock(reference.blockType, block.subBlocks, {
                canonicalModes: block.data?.canonicalModes,
                triggerMode: block.triggerMode,
                selectorKey: 'knowledge.documents',
              }).knowledgeBaseId
            : undefined
          if (isDocument && (!knowledgeBaseId || hasRuntimeReference(knowledgeBaseId))) {
            referenceNotes.add(
              `Document references in block "${reference.blockName || reference.blockId}" were not checked because its active knowledge base ID is empty or requires runtime resolution.`
            )
            return { valid: [], invalid: [] }
          }
          const valid: string[] = []
          const invalid: string[] = []
          for (const id of ids) {
            input.signal?.throwIfAborted()
            try {
              if (isDocument && knowledgeBaseId) {
                await readKnowledgeDocument.execute({
                  principal,
                  input: {
                    knowledgeBaseId,
                    documentId: id,
                    assertedWorkspaceId: graph.workspaceId,
                  },
                  request,
                })
              } else {
                const authorize = readWorkflowGraph.authorize
                if (!authorize) throw new Error('Workflow reference authorization is unavailable')
                await authorize({
                  principal,
                  input: { workflowId: id, assertedWorkspaceId: graph.workspaceId },
                  request,
                })
              }
              valid.push(id)
            } catch (error) {
              if (
                !(error instanceof OrchestrationError) ||
                (error.code !== 'not_found' && error.code !== 'forbidden')
              )
                throw error
              invalid.push(id)
            }
          }
          return { valid, invalid }
        },
      }
    )
    input.signal?.throwIfAborted()
    const referenced = new Map<string, Set<string>>()
    for (const block of Object.values(graph.blocks)) {
      for (const subBlock of Object.values(block.subBlocks ?? {})) {
        collectEnvTokenNames(subBlock.value, referenced, block.name || 'unnamed block')
      }
    }
    const undeclaredEnvVars = await collectUndeclaredEnvVars(
      principal,
      graph.workspaceId,
      referenced,
      input.signal,
      request
    )
    return { ...report, notes: [...report.notes, ...referenceNotes], undeclaredEnvVars }
  },
})

/** Shared with execution so whitespace and accepted token names agree. */
const ENV_TOKEN = createEnvVarPattern()

function hasRuntimeReference(value: string): boolean {
  return createReferencePattern().test(value) || createEnvVarPattern().test(value)
}

/** Read each active table once; column checks consume the Table block's own pure input transform. */
async function readTableDiagnostics(
  graph: ReadWorkflowGraphResult,
  principal: Extract<Principal, { kind: 'session' | 'personal_api_key' }>,
  signal: AbortSignal | undefined,
  request: OrchestrationRequestContext | undefined
): Promise<WorkflowLintTableDiagnostics> {
  const result: WorkflowLintTableDiagnostics = {
    tableFieldIssues: [],
    unresolvedReferences: [],
    notes: [],
  }
  const tables = new Map<
    string,
    Awaited<ReturnType<typeof readTableDefinitionUseCase.execute>>['table'] | null
  >()
  for (const [blockId, block] of Object.entries(graph.blocks)) {
    if (block.type !== 'table_v2') continue
    signal?.throwIfAborted()
    const params: Record<string, unknown> = extractBlockParams(block)
    const tableId = params.tableId
    const blockRef = { blockId, blockName: block.name, blockType: block.type }
    if (typeof tableId !== 'string' || !tableId.trim() || hasRuntimeReference(tableId)) {
      result.notes.push(
        `Table checks in block "${block.name || blockId}" were not completed because its active table ID is empty or requires runtime resolution.`
      )
      continue
    }
    if (!tables.has(tableId)) {
      try {
        const { table } = await readTableDefinitionUseCase.execute({
          principal,
          input: { tableId, workspaceId: graph.workspaceId },
          request,
        })
        tables.set(tableId, table)
      } catch (error) {
        if (
          !(error instanceof OrchestrationError) ||
          (error.code !== 'not_found' && error.code !== 'forbidden')
        )
          throw error
        tables.set(tableId, null)
      }
    }
    signal?.throwIfAborted()
    const table = tables.get(tableId)
    if (!table) {
      result.unresolvedReferences.push({
        ...blockRef,
        field: 'tableId',
        value: tableId,
        kind: 'resource',
        reason: 'Table does not resolve to an accessible table in this workspace.',
      })
      continue
    }
    const transform = getBlock(block.type)?.tools.config?.params
    if (!transform) throw new Error('Table input normalization is unavailable')
    let normalized: Record<string, unknown>
    try {
      normalized = transform(params)
    } catch (error) {
      result.notes.push(
        `Table input checks in block "${block.name || blockId}" could not complete before runtime: ${getErrorMessage(error)}`
      )
      continue
    }
    for (const field of ['filter', 'sort'] as const) {
      const value = normalized[field]
      if (
        value !== undefined &&
        value !== null &&
        !isPlainRecord(value) &&
        !(field === 'sort' && Array.isArray(value))
      ) {
        result.notes.push(
          `Table ${field} in block "${block.name || blockId}" is not a static query object; its column references were not checked.`
        )
      }
    }
    const columnNames = buildIdByName(table.schema)
    const inspectRow = (row: unknown, field: string): void => {
      if (!isPlainRecord(row)) {
        result.notes.push(
          `Table row "${block.name || blockId}".${field} is not a static object; its column keys were not checked.`
        )
        return
      }
      const unknown = unknownColumnNames(row, columnNames)
      const dynamic = unknown.filter(hasRuntimeReference)
      if (dynamic.length > 0) {
        result.notes.push(
          `Table row keys in "${block.name || blockId}".${field} require runtime resolution and were not checked: ${dynamic.join(', ')}.`
        )
      }
      const missing = unknown.filter((name) => !hasRuntimeReference(name))
      if (missing.length > 0) {
        result.unresolvedReferences.push({
          ...blockRef,
          field,
          value: missing,
          kind: 'resource',
          reason: `Row keys ${missing.join(', ')} do not match exact column names in table "${table.name}". Workflow Table row writes omit these keys; use column names from the table schema.`,
        })
      }
    }
    if (Object.hasOwn(normalized, 'data')) inspectRow(normalized.data, 'data')
    if (Object.hasOwn(normalized, 'rows')) {
      if (Array.isArray(normalized.rows)) {
        normalized.rows.forEach((row, index) => inspectRow(row, `rows[${index}]`))
      } else {
        result.notes.push(
          `Table rows in block "${block.name || blockId}" are not a static array; their column keys were not checked.`
        )
      }
    }
    const known = new Set([
      ...columnNames.keys(),
      ...buildNameById(table.schema).keys(),
      'id',
      'createdAt',
      'updatedAt',
    ])
    const fields = new Set([
      ...tableFilterFields(normalized.filter),
      ...collectSortFieldNames(normalized.sort),
    ])
    for (const field of fields) {
      if (hasRuntimeReference(field)) {
        result.notes.push(
          `Table column "${field}" in block "${block.name || blockId}" requires runtime resolution and was not checked.`
        )
      } else if (!known.has(field)) {
        result.tableFieldIssues.push({ ...blockRef, field, tableName: table.name })
      }
    }
  }
  return result
}

/** Both accepted query grammars name columns; nested values are never mistaken for field names. */
function tableFilterFields(root: unknown): string[] {
  if (!isPlainRecord(root)) return []
  if (Array.isArray(root.all) || Array.isArray(root.any)) return collectPredicateFieldNames(root)
  const fields: string[] = []
  const pending: unknown[] = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!isPlainRecord(node)) continue
    for (const [field, value] of Object.entries(node)) {
      if ((field === '$or' || field === '$and') && Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--) pending.push(value[index])
      } else if (value !== undefined && !Array.isArray(value)) fields.push(field)
    }
  }
  return fields
}

function collectEnvTokenNames(
  value: unknown,
  out: Map<string, Set<string>>,
  blockName: string
): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ENV_TOKEN)) {
      const key = match[1]?.trim()
      if (!key) continue
      const blocks = out.get(key) ?? new Set<string>()
      blocks.add(blockName)
      out.set(key, blocks)
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectEnvTokenNames(item, out, blockName)
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectEnvTokenNames(item, out, blockName)
  }
}

/** Absence requires exhausting the visible inventory; only referenced names are retained. */
async function collectUndeclaredEnvVars(
  principal: Extract<Principal, { kind: 'session' | 'personal_api_key' }>,
  workspaceId: string,
  unseen: Map<string, Set<string>>,
  signal: AbortSignal | undefined,
  request: OrchestrationRequestContext | undefined
): Promise<WorkflowLintDiagnostic['undeclaredEnvVars']> {
  const cursors = new Set<string>()
  let cursorKeys: CursorKey[] | undefined
  while (unseen.size > 0) {
    signal?.throwIfAborted()
    const response = await listSecretsUseCase.execute({
      principal,
      input: { workspaceId, sortBy: 'name', sortOrder: 'asc', limit: 100, cursorKeys },
      request,
    })
    signal?.throwIfAborted()
    for (const secret of response.secrets) {
      if (secret.envKey) unseen.delete(secret.envKey)
    }
    if (unseen.size === 0 || !response.nextCursorKeys) break
    const cursor = JSON.stringify(response.nextCursorKeys)
    if (cursors.has(cursor)) {
      throw new Error(
        'Secret inventory pagination did not advance; visibility could not be verified'
      )
    }
    cursors.add(cursor)
    cursorKeys = response.nextCursorKeys
  }
  return [...unseen.entries()]
    .map(([name, blocks]) => ({ name, blocks: [...blocks].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
