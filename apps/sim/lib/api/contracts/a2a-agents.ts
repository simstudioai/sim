import type { AgentCapabilities, AgentSkill, Message } from '@a2a-js/sdk'
import { z } from 'zod'
import type { AgentAuthentication } from '@/lib/a2a/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const dateStringSchema = z.string()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAgentAuthentication(value: unknown): value is AgentAuthentication {
  if (!isRecord(value)) return false

  const schemes = value.schemes
  if (schemes === undefined) return true
  if (!Array.isArray(schemes)) return false

  return schemes.every(
    (scheme) =>
      scheme === 'bearer' || scheme === 'apiKey' || scheme === 'oauth2' || scheme === 'none'
  )
}

export const a2aAgentParamsSchema = z.object({
  agentId: z.string().min(1),
})

export const listA2AAgentsQuerySchema = z.object({
  workspaceId: z.string({ error: 'workspaceId is required' }).min(1, 'workspaceId is required'),
})

export const a2aAgentCapabilitiesSchema = z.custom<AgentCapabilities>(isRecord, {
  message: 'Agent capabilities must be an object',
})

export const a2aAgentAuthenticationSchema = z.custom<AgentAuthentication>(isAgentAuthentication, {
  message: 'Agent authentication must be an object',
})

export const a2aAgentSkillSchema = z.custom<AgentSkill>(isRecord, {
  message: 'Agent skill must be an object',
})

export const createA2AAgentBodySchema = z
  .object({
    workspaceId: z.string({ error: 'workspaceId is required' }).min(1, 'workspaceId is required'),
    workflowId: z.string({ error: 'workflowId is required' }).min(1, 'workflowId is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    capabilities: a2aAgentCapabilitiesSchema.optional(),
    authentication: a2aAgentAuthenticationSchema.optional(),
    skillTags: z.array(z.string()).optional(),
  })
  .passthrough()

export const updateA2AAgentBodySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    capabilities: a2aAgentCapabilitiesSchema.optional(),
    skills: z.array(a2aAgentSkillSchema).optional(),
    authentication: a2aAgentAuthenticationSchema.optional(),
    isPublished: z.boolean().optional(),
    skillTags: z.array(z.string(), { error: 'skillTags must be an array of strings' }).optional(),
  })
  .passthrough()

export const publishA2AAgentBodySchema = z
  .object({
    action: z.enum(['publish', 'unpublish', 'refresh'], { error: 'Invalid action' }),
  })
  .passthrough()

export const a2aAgentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workflowId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  version: z.string(),
  capabilities: a2aAgentCapabilitiesSchema,
  skills: z.array(a2aAgentSkillSchema),
  authentication: a2aAgentAuthenticationSchema,
  isPublished: z.boolean(),
  publishedAt: dateStringSchema.nullable().optional(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
  workflowName: z.string().nullable().optional(),
  workflowDescription: z.string().nullable().optional(),
  isDeployed: z.boolean().nullable().optional(),
  taskCount: z.number().optional(),
})

export const a2aAgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
  protocolVersion: z.string(),
  version: z.string().optional(),
  documentationUrl: z.string().optional(),
  provider: z
    .object({
      organization: z.string(),
      url: z.string().optional(),
    })
    .optional(),
  capabilities: a2aAgentCapabilitiesSchema,
  skills: z.array(a2aAgentSkillSchema),
  authentication: a2aAgentAuthenticationSchema.optional(),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
})

export const listA2AAgentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/a2a/agents',
  query: listA2AAgentsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      agents: z.array(a2aAgentSchema),
    }),
  },
})

export const createA2AAgentContract = defineRouteContract({
  method: 'POST',
  path: '/api/a2a/agents',
  body: createA2AAgentBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      agent: a2aAgentSchema,
    }),
  },
})

export const getA2AAgentCardContract = defineRouteContract({
  method: 'GET',
  path: '/api/a2a/agents/[agentId]',
  params: a2aAgentParamsSchema,
  response: {
    mode: 'json',
    schema: a2aAgentCardSchema,
  },
})

export const updateA2AAgentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/a2a/agents/[agentId]',
  params: a2aAgentParamsSchema,
  body: updateA2AAgentBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      agent: a2aAgentSchema,
    }),
  },
})

export const deleteA2AAgentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/a2a/agents/[agentId]',
  params: a2aAgentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const publishA2AAgentContract = defineRouteContract({
  method: 'POST',
  path: '/api/a2a/agents/[agentId]',
  params: a2aAgentParamsSchema,
  body: publishA2AAgentBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      isPublished: z.boolean().optional(),
      skills: z.array(a2aAgentSkillSchema).optional(),
    }),
  },
})

export type A2AAgent = z.infer<typeof a2aAgentSchema>
export type A2AAgentCard = z.infer<typeof a2aAgentCardSchema>
export type CreateA2AAgentBody = z.input<typeof createA2AAgentBodySchema>
export type UpdateA2AAgentBody = z.input<typeof updateA2AAgentBodySchema>

export const a2aServeAgentParamsSchema = z.object({
  agentId: z.string().min(1),
})
export type A2AServeAgentParams = z.output<typeof a2aServeAgentParamsSchema>

export const a2aJsonRpcIdSchema = z.union([z.string(), z.number(), z.null()])
export type A2AJsonRpcId = z.output<typeof a2aJsonRpcIdSchema>

export const a2aJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: a2aJsonRpcIdSchema,
    method: z.string(),
    params: z.unknown().optional(),
  })
  .passthrough()
export type A2AJsonRpcRequest = z.output<typeof a2aJsonRpcRequestSchema>

export const a2aMessageSendParamsSchema = z
  .object({
    message: z.custom<Message>(
      (message) => typeof message === 'object' && message !== null && !Array.isArray(message)
    ),
  })
  .passthrough()
export type A2AMessageSendParams = z.output<typeof a2aMessageSendParamsSchema>

export const a2aTaskIdParamsSchema = z
  .object({
    id: z.string().min(1),
    historyLength: z.number().optional(),
  })
  .passthrough()
export type A2ATaskIdParams = z.output<typeof a2aTaskIdParamsSchema>

export const a2aPushNotificationSetParamsSchema = z
  .object({
    id: z.string().min(1),
    pushNotificationConfig: z
      .object({
        url: z.string().min(1),
        token: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough()
export type A2APushNotificationSetParams = z.output<typeof a2aPushNotificationSetParamsSchema>
