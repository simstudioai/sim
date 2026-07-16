import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const skillRoleSchema = z.enum(['admin', 'member'])
export const skillMemberStatusSchema = z.enum(['active', 'revoked'])
/**
 * Where a member's role comes from: an explicit `skill_member` row, derived
 * workspace-admin status (undemotable), or implicit workspace-shared access.
 */
export const skillMemberRoleSourceSchema = z.enum(['explicit', 'workspace-admin', 'workspace'])

export type SkillRole = z.output<typeof skillRoleSchema>
export type SkillMemberStatus = z.output<typeof skillMemberStatusSchema>
export type SkillMemberRoleSource = z.output<typeof skillMemberRoleSourceSchema>

export const skillSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  userId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  /** While true, every workspace member has implicit member access to the skill. */
  workspaceShared: z.boolean(),
  /** The caller's effective role on the skill; null for built-in template skills (no ACL). */
  role: skillRoleSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** True for built-in template skills, which are read-only and not stored in the DB. */
  readOnly: z.boolean().optional(),
})

export type Skill = z.output<typeof skillSchema>

export const skillMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: skillRoleSchema,
  status: skillMemberStatusSchema,
  joinedAt: z.string().nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  userImage: z.string().nullable().optional(),
  roleSource: skillMemberRoleSourceSchema,
})

export type SkillMember = z.output<typeof skillMemberSchema>

const skillNameSchema = z
  .string()
  .min(1, 'Skill name is required')
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be kebab-case (e.g. my-skill)')
const skillDescriptionSchema = z.string().min(1, 'Description is required').max(1024)
const skillContentSchema = z
  .string()
  .min(1, 'Content is required')
  .max(50_000, 'Content is too large')

/**
 * One skill in an upsert. Creates (no `id`) require name/description/content;
 * updates (`id` set) are partial — omitted fields keep their current values
 * server-side, so a sharing toggle can never clobber a concurrent content edit.
 */
export const skillUpsertItemSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: skillNameSchema.optional(),
    description: skillDescriptionSchema.optional(),
    content: skillContentSchema.optional(),
    workspaceShared: z.boolean().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.id) return
    if (item.name === undefined) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Skill name is required' })
    }
    if (item.description === undefined) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'Description is required' })
    }
    if (item.content === undefined) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'Content is required' })
    }
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

export const skillIdParamsSchema = z.object({
  id: z.string().min(1, 'Skill id is required'),
})

export const upsertSkillMemberBodySchema = z.object({
  userId: z.string().min(1, 'User id is required'),
  role: skillRoleSchema.default('member'),
})

export type UpsertSkillMemberBody = z.input<typeof upsertSkillMemberBodySchema>

export const removeSkillMemberQuerySchema = z.object({
  userId: z.string().min(1, 'User id is required'),
})

export const listSkillMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/skills/[id]/members',
  params: skillIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      members: z.array(skillMemberSchema),
    }),
  },
})

export const upsertSkillMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/skills/[id]/members',
  params: skillIdParamsSchema,
  body: upsertSkillMemberBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const removeSkillMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/skills/[id]/members',
  params: skillIdParamsSchema,
  query: removeSkillMemberQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})
