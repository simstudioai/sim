import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const skillSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  userId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Skill = z.output<typeof skillSchema>

export const skillUpsertItemSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .min(1, 'Skill name is required')
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be kebab-case (e.g. my-skill)'),
  description: z.string().min(1, 'Description is required').max(1024),
  content: z.string().min(1, 'Content is required').max(50_000, 'Content is too large'),
})

export const listSkillsQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const upsertSkillsBodySchema = z.object({
  skills: z.array(skillUpsertItemSchema),
  workspaceId: z.string().min(1),
  source: z.enum(['settings', 'tool_input']).optional(),
})

export const deleteSkillQuerySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  source: z.enum(['settings', 'tool_input']).optional(),
})

export const importSkillBodySchema = z.object({
  url: z.string().url('A valid URL is required'),
})

export const listSkillsContract = defineRouteContract({
  method: 'GET',
  path: '/api/skills',
  query: listSkillsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(skillSchema),
    }),
  },
})

export const upsertSkillsContract = defineRouteContract({
  method: 'POST',
  path: '/api/skills',
  body: upsertSkillsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.array(skillSchema),
    }),
  },
})

export const deleteSkillContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/skills',
  query: deleteSkillQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const importSkillContract = defineRouteContract({
  method: 'POST',
  path: '/api/skills/import',
  body: importSkillBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      content: z.string(),
    }),
  },
})
