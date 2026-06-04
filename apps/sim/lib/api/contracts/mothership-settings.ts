import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const dateStringSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string()
)

export const mothershipMcpToolRefSchema = z.object({
  serverId: z.string().min(1),
  serverName: z.string().optional(),
  toolName: z.string().min(1),
  title: z.string().optional(),
})

export const mothershipCustomToolRefSchema = z.object({
  customToolId: z.string().min(1),
  title: z.string().optional(),
})

export const mothershipSkillRefSchema = z.object({
  skillId: z.string().min(1),
  name: z.string().optional(),
})

export const mothershipSettingsSchema = z.object({
  workspaceId: z.string().min(1),
  mcpTools: z.array(mothershipMcpToolRefSchema).default([]),
  customTools: z.array(mothershipCustomToolRefSchema).default([]),
  skills: z.array(mothershipSkillRefSchema).default([]),
  createdAt: dateStringSchema.optional(),
  updatedAt: dateStringSchema.optional(),
})

export type MothershipMcpToolRef = z.output<typeof mothershipMcpToolRefSchema>
export type MothershipCustomToolRef = z.output<typeof mothershipCustomToolRefSchema>
export type MothershipSkillRef = z.output<typeof mothershipSkillRefSchema>
export type MothershipSettings = z.output<typeof mothershipSettingsSchema>

export const getMothershipSettingsQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const updateMothershipSettingsBodySchema = z.object({
  workspaceId: z.string().min(1),
  mcpTools: z.array(mothershipMcpToolRefSchema).default([]),
  customTools: z.array(mothershipCustomToolRefSchema).default([]),
  skills: z.array(mothershipSkillRefSchema).default([]),
})

export const getMothershipSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/settings',
  query: getMothershipSettingsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: mothershipSettingsSchema,
    }),
  },
})

export const updateMothershipSettingsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/mothership/settings',
  body: updateMothershipSettingsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: mothershipSettingsSchema,
    }),
  },
})
