import { db } from '@sim/db'
import { customTools, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { BaseServerTool } from '../base-tool'

const logger = createLogger('ManageCustomToolServerTool')

const CustomToolSchemaZ = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.object({
      type: z.string(),
      properties: z.record(z.any()),
      required: z.array(z.string()).optional(),
    }),
  }),
})

export const ManageCustomToolInput = z.object({
  workflowId: z.string().min(1),
  workspaceId: z.string().optional(),
  operation: z.enum(['add', 'edit', 'delete', 'list']),
  toolId: z.string().optional(),
  schema: CustomToolSchemaZ.optional(),
  code: z.string().optional(),
})

type ManageCustomToolResult = {
  success: boolean
  operation: string
  toolId?: string
  functionName?: string
  customTools?: Array<{
    id: string
    title: string
    functionName: string
    description: string
  }>
}

export const manageCustomToolServerTool: BaseServerTool<
  typeof ManageCustomToolInput,
  ManageCustomToolResult
> = {
  name: 'manage_custom_tool',

  async execute(args: unknown, context?: { userId: string }) {
    const parsed = ManageCustomToolInput.parse(args)
    const { workflowId, operation, toolId, schema, code } = parsed

    // Get workspace ID from workflow if not provided
    let workspaceId = parsed.workspaceId
    if (!workspaceId) {
      const [wf] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!wf?.workspaceId) {
        throw new Error('Workflow not found or has no workspace')
      }
      workspaceId = wf.workspaceId
    }

    logger.info('Managing custom tool', {
      operation,
      toolId,
      functionName: schema?.function?.name,
      workspaceId,
    })

    switch (operation) {
      case 'add':
        return await addCustomTool(workspaceId, schema, code, context?.userId)
      case 'edit':
        return await editCustomTool(workspaceId, toolId, schema, code)
      case 'delete':
        return await deleteCustomTool(workspaceId, toolId)
      case 'list':
        return await listCustomTools(workspaceId)
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  },
}

async function addCustomTool(
  workspaceId: string,
  schema: z.infer<typeof CustomToolSchemaZ> | undefined,
  code: string | undefined,
  userId: string | undefined
): Promise<ManageCustomToolResult> {
  if (!schema) {
    throw new Error('Schema is required for adding a custom tool')
  }
  if (!code) {
    throw new Error('Code is required for adding a custom tool')
  }
  if (!userId) {
    throw new Error('User ID is required for adding a custom tool')
  }

  const functionName = schema.function.name

  const [created] = await db
    .insert(customTools)
    .values({
      id: nanoid(),
      workspaceId,
      userId,
      title: functionName,
      schema: schema as any,
      code,
    })
    .returning({ id: customTools.id })

  logger.info(`Created custom tool: ${functionName}`, { toolId: created.id })

  return {
    success: true,
    operation: 'add',
    toolId: created.id,
    functionName,
  }
}

async function editCustomTool(
  workspaceId: string,
  toolId: string | undefined,
  schema: z.infer<typeof CustomToolSchemaZ> | undefined,
  code: string | undefined
): Promise<ManageCustomToolResult> {
  if (!toolId) {
    throw new Error('Tool ID is required for editing a custom tool')
  }
  if (!schema && !code) {
    throw new Error('At least one of schema or code must be provided for editing')
  }

  // Get existing tool
  const [existing] = await db
    .select()
    .from(customTools)
    .where(and(eq(customTools.id, toolId), eq(customTools.workspaceId, workspaceId)))
    .limit(1)

  if (!existing) {
    throw new Error(`Tool with ID ${toolId} not found`)
  }

  const mergedSchema = schema ?? (existing.schema as z.infer<typeof CustomToolSchemaZ>)
  const mergedCode = code ?? existing.code

  await db
    .update(customTools)
    .set({
      title: mergedSchema.function.name,
      schema: mergedSchema as any,
      code: mergedCode,
      updatedAt: new Date(),
    })
    .where(eq(customTools.id, toolId))

  const functionName = mergedSchema.function.name
  logger.info(`Updated custom tool: ${functionName}`, { toolId })

  return {
    success: true,
    operation: 'edit',
    toolId,
    functionName,
  }
}

async function deleteCustomTool(
  workspaceId: string,
  toolId: string | undefined
): Promise<ManageCustomToolResult> {
  if (!toolId) {
    throw new Error('Tool ID is required for deleting a custom tool')
  }

  await db
    .delete(customTools)
    .where(and(eq(customTools.id, toolId), eq(customTools.workspaceId, workspaceId)))

  logger.info(`Deleted custom tool: ${toolId}`)

  return {
    success: true,
    operation: 'delete',
    toolId,
  }
}

async function listCustomTools(workspaceId: string): Promise<ManageCustomToolResult> {
  const tools = await db
    .select({
      id: customTools.id,
      title: customTools.title,
      schema: customTools.schema,
    })
    .from(customTools)
    .where(eq(customTools.workspaceId, workspaceId))

  const formattedTools = tools.map((tool) => {
    const schema = tool.schema as {
      function?: { name?: string; description?: string }
    } | null

    return {
      id: tool.id,
      title: tool.title || '',
      functionName: schema?.function?.name || '',
      description: schema?.function?.description || '',
    }
  })

  logger.info('Listed custom tools', { count: formattedTools.length })

  return {
    success: true,
    operation: 'list',
    customTools: formattedTools,
  }
}
