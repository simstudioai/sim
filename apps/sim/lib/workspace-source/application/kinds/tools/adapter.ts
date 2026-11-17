/**
 * Custom tools as workspace source: `tools/<key>.ts` declares a tool's title and schema, and
 * `tools/<key>.js` holds its code. Every read and write goes through the custom tool use cases, so
 * their authorization, title rules and audit apply; the schema is checked with
 * `assertValidCustomToolDeclaration` at plan time, before anything is written.
 */
import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { Json } from '@sim/workflow-code'
import { type ToolDecl, toolCodec, toolDeclarationPath } from '@sim/workspace-code/kinds/tools'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, isNull, sql } from 'drizzle-orm'
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
import { planUndeclared } from '@/lib/workspace-source/application/findings'
import {
  assertUnchanged,
  bindStored,
  declaredFinding,
  type NamedKind,
  type NamedPlan,
  planNamed,
  readRecord,
  writtenRecord,
} from '@/lib/workspace-source/application/kinds/named'
import type { KindAdapter, PlannedChange } from '@/lib/workspace-source/application/types'
import { claimResourceKey } from '@/lib/workspaces/resource-keys'

/** A stored custom tool as source reads it. */
interface StoredTool {
  title: string
  schema: unknown
  code: string
}

type ToolChange = PlannedChange<ToolDecl, NamedPlan>

const PAGE_SIZE = 200
/** Workflows a delete warning names before it only counts the rest. */
const NAMED_WORKFLOWS = 5

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

/** The stored workflows of the workspace whose blocks name custom tool `toolId`. */
async function workflowsUsing(workspaceId: string, toolId: string) {
  return db
    .selectDistinct({ id: workflow.id, name: workflow.name })
    .from(workflowBlocks)
    .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt),
        sql`jsonb_path_exists(${workflowBlocks.subBlocks}, '$.**.customToolId ? (@ == $id)', jsonb_build_object('id', ${toolId}::text))`
      )
    )
}

/**
 * Warns on each tool the plan deletes (or would, with `--allow-delete`) that stored workflows
 * still use, naming them and counting them in the delete's destructive line.
 */
async function warnInUse(changes: ToolChange[], workspaceId: string): Promise<void> {
  for (const change of changes) {
    const deleting =
      change.action === 'delete' ||
      change.diagnostics.some((finding) => finding.code === 'E_APPLY_DELETE_NOT_ALLOWED')
    if (!deleting || !change.storedId) continue
    const using = await workflowsUsing(workspaceId, change.storedId)
    if (change.destructive) change.destructive.counts.workflows = using.length
    if (using.length === 0) continue
    const listed = using
      .slice(0, NAMED_WORKFLOWS)
      .map((row) => `"${row.name}"`)
      .join(', ')
    const more = using.length > NAMED_WORKFLOWS ? ` and ${using.length - NAMED_WORKFLOWS} more` : ''
    change.diagnostics.push({
      code: 'W_TOOL_IN_USE',
      severity: 'warning',
      message: `Deleting tools/${change.key} breaks ${using.length} stored workflow(s) that use it: ${listed}${more}.`,
      hint: 'Remove the tool from those workflows, or keep its declaration.',
      kind: 'custom-tool',
      key: change.key,
    })
  }
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
    return bindStored(ctx, 'custom-tool', records, allocate)
  },

  async plan(desired, stored, ctx) {
    const claimed = new Map<string, string>()
    const changes: ToolChange[] = []
    for (const [key, decl] of desired) {
      const change = planNamed(tools, key, decl, stored, ctx, toolDeclarationPath(key), claimed)
      try {
        assertValidCustomToolDeclaration(decl.schema)
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
    const undeclared = planUndeclared<StoredTool, ToolDecl, NamedPlan>(
      'custom-tool',
      desired,
      stored,
      ctx,
      () => ({ what: 'custom tool', counts: { workflows: 0 } })
    )
    await warnInUse(undeclared, ctx.workspace.workspaceId)
    return [...changes, ...undeclared]
  },

  async authorize(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'create' && change.decl) {
      await createWorkspaceCustomToolUseCase.authorize({
        principal,
        input: { workspaceId, ...change.decl },
      })
      return
    }
    const toolId = change.storedId
    if (!toolId) return
    if (change.action === 'delete') {
      await deleteWorkspaceCustomToolUseCase.authorize({
        principal,
        input: { workspaceId, toolId },
      })
      return
    }
    await updateWorkspaceCustomToolUseCase.authorize({ principal, input: { workspaceId, toolId } })
  },

  async apply(change, ctx) {
    const { principal } = ctx
    const workspaceId = ctx.workspace.workspaceId
    if (change.action === 'delete') {
      if (!change.storedId) throw new Error('A custom tool delete needs the stored tool id')
      await deleteWorkspaceCustomToolUseCase.execute({
        principal,
        input: { workspaceId, toolId: change.storedId, source: 'api' },
      })
      return { id: change.storedId, text: {} }
    }
    const decl = change.decl
    if (!decl) throw new Error('A custom tool write needs its declaration')
    if (change.action === 'create') {
      const { tool } = await createWorkspaceCustomToolUseCase.execute({
        principal,
        input: { workspaceId, ...decl, source: 'api' },
      })
      await claimResourceKey({
        workspaceId,
        kind: 'custom-tool',
        key: change.key,
        resourceId: tool.id,
        origin: 'created',
        createdBy: ctx.createdBy,
      })
      return writtenRecord(tools, change.key, { id: tool.id, state: tool })
    }
    const toolId = change.storedId
    if (!toolId) throw new Error('A custom tool update needs the stored tool id')
    const { tool: current } = await getWorkspaceCustomToolUseCase.execute({
      principal,
      input: { workspaceId, toolId },
    })
    assertUnchanged(tools, change, current)
    if (change.action === 'adopt') {
      await claimResourceKey({
        workspaceId,
        kind: 'custom-tool',
        key: change.key,
        resourceId: toolId,
        origin: 'adopted',
        createdBy: ctx.createdBy,
      })
    }
    if (!change.detail?.changed.length) {
      return writtenRecord(tools, change.key, { id: toolId, state: current })
    }
    const { tool } = await updateWorkspaceCustomToolUseCase.execute({
      principal,
      input: { workspaceId, toolId, ...decl, source: 'api' },
    })
    return writtenRecord(tools, change.key, { id: toolId, state: tool })
  },

  async read(stored) {
    if (!isSchemaObject(stored.state.schema)) {
      throw new OrchestrationError('validation', 'The stored schema is not an object.')
    }
    return readRecord(tools, stored)
  },
}
