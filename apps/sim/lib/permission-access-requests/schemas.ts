import { z } from 'zod'
import type { AccessRequestTarget as DomainAccessRequestTarget } from '@/lib/permission-groups/access-requests/targets'
import { PLATFORM_FEATURES } from '@/lib/permission-groups/features'
import { FILE_SHARE_AUTH_TYPES, PERMISSION_GROUP_FIELDS } from '@/lib/permission-groups/fields'

const targetIdSchema = z.string().min(1, 'Target ID cannot be empty').max(512)
const fingerprintSchema = z.string().min(1, 'A current preview is required').max(128)

/** Canonical validators for the target and decision JSON persisted with a request. */
export const storedAccessRequestTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('feature'),
      configKey: z.enum(PLATFORM_FEATURES.map((feature) => feature.configKey)),
    })
    .strict(),
  z.object({ kind: z.literal('integration'), id: targetIdSchema }).strict(),
  z.object({ kind: z.literal('provider'), id: targetIdSchema }).strict(),
  z.object({ kind: z.literal('model'), id: targetIdSchema }).strict(),
  z.object({ kind: z.literal('tool'), id: targetIdSchema }).strict(),
  z.object({ kind: z.literal('knowledge_connector'), id: targetIdSchema }).strict(),
  z.object({ kind: z.literal('file_share_auth'), id: z.enum(FILE_SHARE_AUTH_TYPES) }).strict(),
  z.object({ kind: z.literal('chat_deploy_auth'), id: z.enum(FILE_SHARE_AUTH_TYPES) }).strict(),
  z.object({ kind: z.literal('usage_limit'), id: z.literal('member') }).strict(),
]) satisfies z.ZodType<DomainAccessRequestTarget>
export const storedAccessRequestPolicyValueSchema = z.union([
  z.boolean(),
  z.array(z.string().max(512)).max(10_000),
  z.null(),
])

export const storedAccessRequestPolicyChangeSchema = z.object({
  configKey: z.enum(
    Object.keys(PERMISSION_GROUP_FIELDS) as (keyof typeof PERMISSION_GROUP_FIELDS)[]
  ),
  label: z.string().min(1).max(512),
  before: storedAccessRequestPolicyValueSchema,
  after: storedAccessRequestPolicyValueSchema,
})

export const storedAccessRequestDecisionSchema = z.object({
  resolutionKind: z.enum(['permission', 'usage_limit']),
  changes: z
    .array(storedAccessRequestPolicyChangeSchema)
    .max(Object.keys(PERMISSION_GROUP_FIELDS).length),
  impact: z.object({
    memberCount: z.number().int().nonnegative(),
    workspaceCount: z.number().int().nonnegative(),
    workspaceNames: z.array(z.string().max(255)).max(100),
    truncated: z.boolean(),
  }),
  group: z.object({ id: z.string().min(1).max(128), name: z.string().max(255) }).nullable(),
  currentLimitCredits: z.number().finite().nonnegative().nullable(),
  newLimitCredits: z.number().finite().nonnegative().nullable(),
  fingerprint: fingerprintSchema,
})
export type AccessRequestDecision = z.output<typeof storedAccessRequestDecisionSchema>
