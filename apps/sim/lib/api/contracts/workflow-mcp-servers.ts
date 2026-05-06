import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const dateStringSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string()
)

export const workflowMcpWorkspaceQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const workflowMcpServerParamsSchema = z.object({
  id: z.string().min(1),
})

export const workflowMcpToolParamsSchema = workflowMcpServerParamsSchema.extend({
  toolId: z.string().min(1),
})

export const workflowMcpServerSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    createdBy: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isPublic: z.boolean(),
    createdAt: dateStringSchema,
    updatedAt: dateStringSchema,
    toolCount: z.number().optional(),
    toolNames: z.array(z.string()).optional(),
  })
  .passthrough()
export type WorkflowMcpServer = z.output<typeof workflowMcpServerSchema>

export const workflowMcpToolSchema = z
  .object({
    id: z.string(),
    serverId: z.string(),
    workflowId: z.string(),
    toolName: z.string(),
    toolDescription: z.string().nullable(),
    parameterSchema: z.record(z.string(), z.unknown()),
    createdAt: dateStringSchema,
    updatedAt: dateStringSchema,
    workflowName: z.string().nullable().optional(),
    workflowDescription: z.string().nullable().optional(),
    isDeployed: z.boolean().nullable().optional(),
  })
  .passthrough()
export type WorkflowMcpTool = z.output<typeof workflowMcpToolSchema>

export const deployedWorkflowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    isDeployed: z.boolean().optional().default(false),
  })
  .passthrough()
export type DeployedWorkflow = z.output<typeof deployedWorkflowSchema>

export const createWorkflowMcpServerBodySchema = z
  .object({
    workspaceId: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    isPublic: z.boolean().optional(),
    workflowIds: z.array(z.string()).optional(),
  })
  .passthrough()

export const updateWorkflowMcpServerBodySchema = z
  .object({
    workspaceId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    isPublic: z.boolean().optional(),
  })
  .passthrough()

export const createWorkflowMcpToolBodySchema = z
  .object({
    workspaceId: z.string().optional(),
    workflowId: z.string().min(1),
    toolName: z.string().optional(),
    toolDescription: z.string().optional(),
    parameterSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const updateWorkflowMcpToolBodySchema = z
  .object({
    workspaceId: z.string().optional(),
    toolName: z.string().optional(),
    toolDescription: z.string().nullable().optional(),
    parameterSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const workflowMcpDeployedWorkflowsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  scope: z.enum(['active', 'archived', 'all']).default('active'),
})

const workflowMcpSuccessResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export const listWorkflowMcpServersContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/workflow-servers',
  query: workflowMcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        servers: z.array(workflowMcpServerSchema),
      })
    ),
  },
})

export const createWorkflowMcpServerContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/workflow-servers',
  body: createWorkflowMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        server: workflowMcpServerSchema,
        addedTools: z.array(z.object({ workflowId: z.string(), toolName: z.string() })),
      })
    ),
  },
})

export const getWorkflowMcpServerContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/workflow-servers/[id]',
  params: workflowMcpServerParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        server: workflowMcpServerSchema,
        tools: z.array(workflowMcpToolSchema),
      })
    ),
  },
})

export const updateWorkflowMcpServerContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/mcp/workflow-servers/[id]',
  params: workflowMcpServerParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  body: updateWorkflowMcpServerBodySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        server: workflowMcpServerSchema,
      })
    ),
  },
})

export const deleteWorkflowMcpServerContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/mcp/workflow-servers/[id]',
  params: workflowMcpServerParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        message: z.string(),
      })
    ),
  },
})

export const listWorkflowMcpToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/mcp/workflow-servers/[id]/tools',
  params: workflowMcpServerParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        tools: z.array(workflowMcpToolSchema),
      })
    ),
  },
})

export const createWorkflowMcpToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/workflow-servers/[id]/tools',
  params: workflowMcpServerParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  body: createWorkflowMcpToolBodySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        tool: workflowMcpToolSchema,
      })
    ),
  },
})

export const updateWorkflowMcpToolContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/mcp/workflow-servers/[id]/tools/[toolId]',
  params: workflowMcpToolParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  body: updateWorkflowMcpToolBodySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        tool: workflowMcpToolSchema,
      })
    ),
  },
})

export const deleteWorkflowMcpToolContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/mcp/workflow-servers/[id]/tools/[toolId]',
  params: workflowMcpToolParamsSchema,
  query: workflowMcpWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: workflowMcpSuccessResponseSchema(
      z.object({
        message: z.string(),
      })
    ),
  },
})

export const listWorkflowMcpDeployedWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows',
  query: workflowMcpDeployedWorkflowsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(deployedWorkflowSchema),
    }),
  },
})
