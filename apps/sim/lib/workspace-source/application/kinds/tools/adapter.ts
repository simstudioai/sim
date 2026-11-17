/**
 * Custom tools as workspace source: `tools/<key>.ts` declares a tool's title and schema, and
 * `tools/<key>.js` holds its code. Every read and write goes through the custom tool use cases, so
 * their authorization, title rules and audit apply. A declared schema is checked with
 * `assertValidCustomToolDeclaration` at plan time when it is created or changed, as the use case
 * checks a schema it is sent; an unchanged stored schema is never re-judged by a newer rule.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { Json } from '@sim/workflow-code'
import { type ToolDecl, toolCodec, toolDeclarationPath } from '@sim/workspace-code/kinds/tools'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createWorkspaceCustomToolUseCase,
  deleteWorkspaceCustomToolUseCase,
  getWorkspaceCustomToolUseCase,
  listWorkspaceCustomToolsUseCase,
  updateWorkspaceCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { assertValidCustomToolDeclaration } from '@/lib/custom-tools/schema'
import { bindStored } from '@/lib/workspace-source/application/keys'
import {
  applyNamed,
  authorizeNamed,
  declaredFinding,
  type NamedKind,
  type NamedPlan,
  planNamed,
  planNamedUndeclared,
  readRecord,
  storedFingerprint,
  writtenFields,
} from '@/lib/workspace-source/application/kinds/named'
import type {
  KindAdapter,
  PlannedChange,
  SourceContext,
} from '@/lib/workspace-source/application/types'

/** A stored custom tool as source reads it. */
interface StoredTool {
  title: string
  schema: unknown
  code: string
}

type ToolChange = PlannedChange<ToolDecl, NamedPlan>

const PAGE_SIZE = 200

const tools: NamedKind<ToolDecl, StoredTool> = {
  kind: 'custom-tool',
  codec: toolCodec,
  noun: 'custom tool',
  nameOf: (decl) => decl.title,
  /** A schema that is not an object (a legacy row) reads as `{}`; a get leaves such a tool out. */
  declOf: (state) => ({
    title: state.title,
    schema: isSchemaObject(state.schema) ? state.schema : {},
    code: state.code,
  }),
}

function isSchemaObject(value: unknown): value is Record<string, Json> {
  return isRecordLike(value)
}

async function getTool(ctx: SourceContext, toolId: string): Promise<StoredTool> {
  const { tool } = await getWorkspaceCustomToolUseCase.execute({
    principal: ctx.principal,
    input: { workspaceId: ctx.workspace.workspaceId, toolId },
  })
  return tool
}

export const toolAdapter: KindAdapter<ToolDecl, StoredTool, NamedPlan> = {
  codec: toolCodec,

  async load(ctx, { allocate }) {
    const records: Array<{ id: string; name: string; state: StoredTool }> = []
    let cursorKeys: CursorKey[] | undefined
    do {
      const page = await listWorkspaceCustomToolsUseCase.execute({
        principal: ctx.principal,
        input: {
          workspaceId: ctx.workspace.workspaceId,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: PAGE_SIZE,
          ...(cursorKeys ? { cursorKeys } : {}),
        },
      })
      for (const tool of page.tools) records.push({ id: tool.id, name: tool.title, state: tool })
      cursorKeys = page.nextCursorKeys ?? undefined
    } while (cursorKeys && records.length <= WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind)
    return bindStored(ctx, 'custom-tool', records, { allocate })
  },

  async plan(desired, stored, ctx) {
    const claimed = new Map<string, string>()
    const changes: ToolChange[] = []
    for (const [key, decl] of desired) {
      const change = planNamed(tools, key, decl, stored, ctx, toolDeclarationPath(key), claimed)
      try {
        if (writtenFields(change).includes('schema')) assertValidCustomToolDeclaration(decl.schema)
      } catch (error) {
        if (!(error instanceof OrchestrationError)) throw error
        change.diagnostics.push(
          declaredFinding(
            'custom-tool',
            key,
            toolDeclarationPath(key),
            'E_TOOL_SCHEMA',
            getErrorMessage(error)
          )
        )
      }
      changes.push(change)
    }
    const undeclared = planNamedUndeclared(tools, desired, stored, ctx, changes, () => ({
      what: 'custom tool',
      counts: { workflows: 0 },
    }))
    return [...changes, ...undeclared]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    await authorizeNamed(change, {
      create: (decl) =>
        createWorkspaceCustomToolUseCase.authorize({ principal, input: { workspaceId, ...decl } }),
      update: (toolId) =>
        updateWorkspaceCustomToolUseCase.authorize({ principal, input: { workspaceId, toolId } }),
      remove: (toolId) =>
        deleteWorkspaceCustomToolUseCase.authorize({ principal, input: { workspaceId, toolId } }),
    })
  },

  async fingerprintNow(change, ctx) {
    if (!change.storedId) throw new Error('A custom tool check needs the stored id')
    return storedFingerprint(tools, await getTool(ctx, change.storedId))
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    return applyNamed(tools, change, {
      async create(decl) {
        const { tool } = await createWorkspaceCustomToolUseCase.execute({
          principal,
          input: { workspaceId, ...decl, source: 'api' },
        })
        return { id: tool.id, state: tool }
      },
      get: (toolId) => getTool(ctx, toolId),
      async update(toolId, fields) {
        const { tool } = await updateWorkspaceCustomToolUseCase.execute({
          principal,
          input: { workspaceId, toolId, ...fields, source: 'api' },
        })
        return tool
      },
      async remove(toolId) {
        await deleteWorkspaceCustomToolUseCase.execute({
          principal,
          input: { workspaceId, toolId, source: 'api' },
        })
      },
    })
  },

  async read(stored) {
    if (!isSchemaObject(stored.state.schema)) {
      throw new OrchestrationError('validation', 'The stored schema is not an object.')
    }
    return readRecord(tools, stored)
  },
}
