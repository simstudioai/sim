import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const customToolFunctionParametersSchema = z
  .object({
    type: z.string(),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  })
  .passthrough()

export const customToolSchemaSchema = z
  .object({
    type: z.literal('function'),
    function: z
      .object({
        name: z.string().min(1, 'Function name is required'),
        description: z.string().optional(),
        parameters: customToolFunctionParametersSchema,
      })
      .passthrough(),
  })
  .passthrough()

export const customToolUpsertItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'Tool title is required'),
  schema: customToolSchemaSchema,
  code: z.string(),
})

export const customToolsQuerySchema = z.object({
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
})

export const upsertCustomToolsBodySchema = z.object({
  tools: z.array(customToolUpsertItemSchema),
  workspaceId: z.string().optional(),
  source: z.enum(['settings', 'tool_input']).optional(),
})

export const deleteCustomToolQuerySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().optional(),
  source: z.enum(['settings', 'tool_input']).optional().catch(undefined),
})

export const listCustomToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/custom',
  query: customToolsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(z.unknown()),
    }),
  },
})

export const upsertCustomToolsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/custom',
  body: upsertCustomToolsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.array(z.unknown()),
    }),
  },
})

export const deleteCustomToolContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/tools/custom',
  query: deleteCustomToolQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})
