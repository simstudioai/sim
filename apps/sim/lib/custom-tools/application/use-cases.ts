import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
} from '@sim/auth/principal'
import type { customTools } from '@sim/db/schema'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { customToolDelegationPolicy } from '@/lib/custom-tools/application/authorization'
import { customToolOperations } from '@/lib/custom-tools/application/operations'
import {
  assertStorableCustomToolSchema,
  assertValidCustomToolDeclaration,
} from '@/lib/custom-tools/schema'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import {
  type CustomToolSortBy,
  deleteCustomTool,
  deleteWorkspaceCustomTool,
  getCustomToolById,
  getWorkspaceCustomTool,
  getWorkspaceCustomToolByTitle,
  listCustomTools,
  listWorkspaceCustomTools,
  updateCustomTool,
  updateWorkspaceCustomTool,
  upsertCustomTools,
} from '@/lib/workflows/custom-tools/operations'

type CustomToolRow = typeof customTools.$inferSelect
type CustomToolWriteSource = 'api' | 'settings' | 'tool_input'

interface CustomToolWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

interface CustomToolContext extends CustomToolWorkspaceContext {
  tool: CustomToolRow
}

async function resolveWorkspaceContext(workspaceId: string): Promise<CustomToolWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveWorkspaceToolContext(
  workspaceId: string,
  toolId: string
): Promise<CustomToolContext> {
  const workspace = await resolveWorkspaceContext(workspaceId)
  const tool = await getWorkspaceCustomTool({ workspaceId: workspace.workspaceId, toolId })
  if (!tool) throw new OrchestrationError('not_found', 'Custom tool not found')
  return { ...workspace, tool }
}

async function resolveAvailableToolContext(args: {
  principal: Exclude<Principal, { kind: 'workspace_api_key' }>
  workspaceId: string
  toolId: string
}): Promise<CustomToolContext> {
  const workspace = await resolveWorkspaceContext(args.workspaceId)
  const tool = await getCustomToolById({
    toolId: args.toolId,
    userId: requirePrincipalSubjectUserId(args.principal),
    workspaceId: workspace.workspaceId,
  })
  if (!tool) throw new OrchestrationError('not_found', 'Custom tool not found')
  return { ...workspace, tool }
}

function customToolConflict(error: unknown): never {
  if (getPostgresErrorCode(error) === '23505') {
    throw new OrchestrationError(
      'conflict',
      'A custom tool with that title already exists in this workspace'
    )
  }
  const message = getErrorMessage(error, '')
  if (/already exists in this workspace/i.test(message)) {
    throw new OrchestrationError('conflict', message)
  }
  throw error
}

const authorizationOptions = { delegation: customToolDelegationPolicy }

export interface ListWorkspaceCustomToolsInput {
  workspaceId: string
  search?: string
  sortBy?: CustomToolSortBy
  sortOrder?: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}

export const listWorkspaceCustomToolsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.list,
  resolveContext: ({ input }: { input: ListWorkspaceCustomToolsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const page = await listWorkspaceCustomTools({ ...input, workspaceId: context.workspaceId })
    return {
      tools: page.data,
      nextCursorKeys: page.nextCursorKeys,
      sortBy: input.sortBy ?? 'createdAt',
      sortOrder: input.sortOrder ?? 'desc',
    }
  },
})

export interface ListAvailableCustomToolsInput {
  workspaceId: string
}

export const listAvailableCustomToolsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.listAvailable,
  resolveContext: ({ input }: { input: ListAvailableCustomToolsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, context }) {
    const tools = await listCustomTools({
      userId: requirePrincipalSubjectUserId(principal),
      workspaceId: context.workspaceId,
    })
    return { tools }
  },
})

export interface GetWorkspaceCustomToolInput {
  workspaceId: string
  toolId: string
}

export const getWorkspaceCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.read,
  resolveContext: ({ input }: { input: GetWorkspaceCustomToolInput }) =>
    resolveWorkspaceToolContext(input.workspaceId, input.toolId),
  authorizationOptions,
  async execute({ context }) {
    return { tool: context.tool }
  },
})

export interface CreateWorkspaceCustomToolInput {
  workspaceId: string
  title: string
  schema: unknown
  code: string
  source?: CustomToolWriteSource
}

export const createWorkspaceCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.create,
  resolveContext: ({ input }: { input: CreateWorkspaceCustomToolInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    if (
      await getWorkspaceCustomToolByTitle({ workspaceId: context.workspaceId, title: input.title })
    ) {
      throw new OrchestrationError(
        'conflict',
        `A custom tool titled "${input.title}" already exists in this workspace`
      )
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    try {
      const tools = await upsertCustomTools({
        tools: [{ title: input.title, schema: input.schema, code: input.code }],
        workspaceId: context.workspaceId,
        userId: attribution.attributedUserId,
      })
      const tool = tools.find((candidate) => candidate.title === input.title)
      if (!tool) throw new Error(`Custom tool "${input.title}" missing after a successful write`)
      return { tool }
    } catch (error) {
      return customToolConflict(error)
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CUSTOM_TOOL_CREATED,
    resourceType: AuditResourceType.CUSTOM_TOOL,
    resourceId: result.tool.id,
    resourceName: result.tool.title,
    description: `Created custom tool "${result.tool.title}"`,
    metadata: { source: input.source },
  }),
})

export const saveWorkspaceCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.save,
  resolveContext: ({ input }: { input: CreateWorkspaceCustomToolInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    try {
      const tools = await upsertCustomTools({
        tools: [{ title: input.title, schema: input.schema, code: input.code }],
        workspaceId: context.workspaceId,
        userId: attribution.attributedUserId,
      })
      const tool = tools.find((candidate) => candidate.title === input.title)
      if (!tool) throw new Error(`Custom tool "${input.title}" missing after a successful save`)
      return { tool }
    } catch (error) {
      return customToolConflict(error)
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CUSTOM_TOOL_CREATED,
    resourceType: AuditResourceType.CUSTOM_TOOL,
    resourceId: result.tool.id,
    resourceName: result.tool.title,
    description: `Created custom tool "${result.tool.title}"`,
    metadata: { source: input.source },
  }),
})

interface UpdateCustomToolFields {
  title?: string
  schema?: unknown
  code?: string
  source?: CustomToolWriteSource
}

export interface UpdateWorkspaceCustomToolInput extends UpdateCustomToolFields {
  workspaceId: string
  toolId: string
}

async function ensureTitleAvailable(context: CustomToolContext, title: string): Promise<void> {
  if (title === context.tool.title) return
  if (context.tool.workspaceId === null) return
  const collision = await getWorkspaceCustomToolByTitle({
    workspaceId: context.workspaceId,
    title,
  })
  if (collision && collision.id !== context.tool.id) {
    throw new OrchestrationError(
      'conflict',
      `A custom tool titled "${title}" already exists in this workspace`
    )
  }
}

export const updateWorkspaceCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspaceCustomToolInput }) =>
    resolveWorkspaceToolContext(input.workspaceId, input.toolId),
  authorizationOptions,
  async execute({ input, context }) {
    const title = input.title ?? context.tool.title
    await ensureTitleAvailable(context, title)
    const schema = input.schema ?? context.tool.schema
    /**
     * The merged schema, not only a supplied one: this surface parses the tool
     * it returns, so an update that falls back to a stored schema the response
     * cannot serialize used to commit and audit and only then fail — telling
     * the caller the write failed after it had succeeded. Refusing before the
     * write makes that error true.
     */
    assertStorableCustomToolSchema(schema)
    if (input.schema !== undefined) assertValidCustomToolDeclaration(input.schema)
    try {
      const tool = await updateWorkspaceCustomTool({
        workspaceId: context.workspaceId,
        toolId: context.tool.id,
        title,
        schema,
        code: input.code ?? context.tool.code,
      })
      if (!tool) throw new OrchestrationError('not_found', 'Custom tool not found')
      return { tool }
    } catch (error) {
      return customToolConflict(error)
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CUSTOM_TOOL_UPDATED,
    resourceType: AuditResourceType.CUSTOM_TOOL,
    resourceId: result.tool.id,
    resourceName: result.tool.title,
    description: `Updated custom tool "${result.tool.title}"`,
    metadata: { source: input.source },
  }),
})

export const updateAvailableCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.updateAvailable,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Exclude<Principal, { kind: 'workspace_api_key' }>
    input: UpdateWorkspaceCustomToolInput
  }) =>
    resolveAvailableToolContext({
      principal,
      workspaceId: input.workspaceId,
      toolId: input.toolId,
    }),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const title = input.title ?? context.tool.title
    await ensureTitleAvailable(context, title)
    /**
     * Only a supplied schema, unlike the public update above: this surface does
     * not parse what it returns, so an edit that merely keeps a legacy stored
     * schema still succeeds, while a caller-supplied one is held to the shape
     * the public API has to publish.
     */
    if (input.schema !== undefined) assertValidCustomToolDeclaration(input.schema)
    try {
      const tool = await updateCustomTool({
        workspaceId: context.workspaceId,
        toolId: context.tool.id,
        userId: requirePrincipalSubjectUserId(principal),
        title,
        schema: input.schema ?? context.tool.schema,
        code: input.code ?? context.tool.code,
      })
      if (!tool) throw new OrchestrationError('not_found', 'Custom tool not found')
      return { tool }
    } catch (error) {
      return customToolConflict(error)
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CUSTOM_TOOL_UPDATED,
    resourceType: AuditResourceType.CUSTOM_TOOL,
    resourceId: result.tool.id,
    resourceName: result.tool.title,
    description: `Updated custom tool "${result.tool.title}"`,
    metadata: { source: input.source },
  }),
})

export interface DeleteWorkspaceCustomToolInput {
  workspaceId: string
  toolId: string
  source?: CustomToolWriteSource
}

export const deleteWorkspaceCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.delete,
  resolveContext: ({ input }: { input: DeleteWorkspaceCustomToolInput }) =>
    resolveWorkspaceToolContext(input.workspaceId, input.toolId),
  authorizationOptions,
  async execute({ context }) {
    const deleted = await deleteWorkspaceCustomTool({
      workspaceId: context.workspaceId,
      toolId: context.tool.id,
    })
    if (!deleted) throw new OrchestrationError('not_found', 'Custom tool not found')
    return { tool: context.tool }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CUSTOM_TOOL_DELETED,
    resourceType: AuditResourceType.CUSTOM_TOOL,
    resourceId: result.tool.id,
    resourceName: result.tool.title,
    description: `Deleted custom tool "${result.tool.title}"`,
    metadata: { source: input.source },
  }),
})

export const deleteAvailableCustomToolUseCase = defineAuthorizedWorkspaceUseCase({
  operation: customToolOperations.deleteAvailable,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Exclude<Principal, { kind: 'workspace_api_key' }>
    input: DeleteWorkspaceCustomToolInput
  }) =>
    resolveAvailableToolContext({
      principal,
      workspaceId: input.workspaceId,
      toolId: input.toolId,
    }),
  authorizationOptions,
  async execute({ principal, context }) {
    const deleted = await deleteCustomTool({
      workspaceId: context.workspaceId,
      toolId: context.tool.id,
      userId: requirePrincipalSubjectUserId(principal),
    })
    if (!deleted) throw new OrchestrationError('not_found', 'Custom tool not found')
    return { tool: context.tool }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.CUSTOM_TOOL_DELETED,
    resourceType: AuditResourceType.CUSTOM_TOOL,
    resourceId: result.tool.id,
    resourceName: result.tool.title,
    description: `Deleted custom tool "${result.tool.title}"`,
    metadata: { source: input.source },
  }),
})
