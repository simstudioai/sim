import { z } from 'zod'
import { PLATFORM_FEATURES } from '@/lib/permission-groups/features'
import { FILE_SHARE_AUTH_TYPES, PERMISSION_GROUP_FIELDS } from '@/lib/permission-groups/fields'
import type { AccessRequestTarget as DomainAccessRequestTarget } from '@/ee/access-requests/lib/targets'

const targetIdSchema = z
  .string()
  .min(1, 'Target ID cannot be empty')
  .max(512)
  .describe('Identifier returned by access discovery.')
const fingerprintSchema = z.string().min(1, 'A current preview is required').max(128)

/** Canonical validators for the target and decision JSON persisted with a request. */
export const storedAccessRequestTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('feature').describe('Kind of access being requested.'),
      configKey: z
        .enum(PLATFORM_FEATURES.map((feature) => feature.configKey))
        .describe('Feature restriction key returned by access discovery.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('integration').describe('Kind of access being requested.'),
      id: targetIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('provider').describe('Kind of access being requested.'),
      id: targetIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('model').describe('Kind of access being requested.'),
      id: targetIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool').describe('Kind of access being requested.'),
      id: targetIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('knowledge_connector').describe('Kind of access being requested.'),
      id: targetIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('file_share_auth').describe('Kind of access being requested.'),
      id: z.enum(FILE_SHARE_AUTH_TYPES).describe('Authentication mode to request.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('chat_deploy_auth').describe('Kind of access being requested.'),
      id: z.enum(FILE_SHARE_AUTH_TYPES).describe('Authentication mode to request.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('usage_limit').describe('Kind of access being requested.'),
      id: z
        .literal('member')
        .describe('Request an increase to the acting user’s member credit cap.'),
    })
    .strict(),
]) satisfies z.ZodType<DomainAccessRequestTarget>
export const storedAccessRequestPolicyValueSchema = z.union([
  z.boolean(),
  PERMISSION_GROUP_FIELDS.allowedIntegrations.readSchema,
])

export const storedAccessRequestPolicyChangeSchema = z
  .object({
    configKey: z
      .enum(Object.keys(PERMISSION_GROUP_FIELDS) as (keyof typeof PERMISSION_GROUP_FIELDS)[])
      .describe('Permission restriction changed by approval.'),
    label: z.string().min(1).max(512).describe('Human-readable permission name.'),
    before: storedAccessRequestPolicyValueSchema.describe('Current value of the restriction.'),
    after: storedAccessRequestPolicyValueSchema.describe('Value after applying the request.'),
  })
  .superRefine((change, context) => {
    const schema = PERMISSION_GROUP_FIELDS[change.configKey].readSchema
    for (const side of ['before', 'after'] as const) {
      if (!schema.safeParse(change[side]).success) {
        context.addIssue({
          code: 'custom',
          path: [side],
          message: `Invalid ${side} value for ${change.configKey}`,
        })
      }
    }
  })

export const storedAccessRequestDecisionSchema = z.object({
  resolutionKind: z
    .enum(['permission', 'usage_limit'])
    .describe('Whether approval changes group permissions or a member credit cap.'),
  changes: z
    .array(storedAccessRequestPolicyChangeSchema)
    .max(Object.keys(PERMISSION_GROUP_FIELDS).length)
    .describe('Permission changes applied to the governing group.'),
  impact: z
    .object({
      memberCount: z.number().int().nonnegative().describe('Number of affected members.'),
      workspaceCount: z.number().int().nonnegative().describe('Number of affected workspaces.'),
      workspaceNames: z
        .array(z.string())
        .max(100)
        .describe('Names of affected workspaces, capped at 100.'),
      truncated: z
        .boolean()
        .describe('Whether the workspace-name list is truncated; counts include the full impact.'),
    })
    .describe('Members and workspaces affected by approval.'),
  group: z
    .object({
      id: z.string().min(1).max(128).describe('Governing group identifier.'),
      name: z.string().describe('Governing group name.'),
    })
    .nullable()
    .describe('Group affected by a permission approval; null for credit-cap changes.'),
  currentLimitCredits: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .describe('Current member credit cap; null for permission changes.'),
  newLimitCredits: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .describe('Applied member credit cap; null before approval or for permission changes.'),
  fingerprint: fingerprintSchema.describe(
    'Fingerprint binding approval to this policy and membership snapshot.'
  ),
})
export type AccessRequestDecision = z.output<typeof storedAccessRequestDecisionSchema>
