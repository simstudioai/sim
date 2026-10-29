import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { ASSISTANT_REVIEW_FIELD_MAX_CHARS } from '@/lib/assistant-actions/limits'

const policySchema = z.enum(['allow', 'ask', 'block'])
const toolIdSchema = z.string().min(1).max(256)
const permissionParamsSchema = z.object({
  id: organizationIdSchema,
  credentialId: z.string().min(1).max(128),
})
const permissionPath =
  '/api/organizations/[id]/connected-accounts/personal/[credentialId]/tool-permissions'

export const readAssistantToolPermissionsContract = defineRouteContract({
  method: 'GET',
  path: permissionPath,
  params: permissionParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      account: z.object({
        credentialId: z.string().min(1).max(128),
        displayName: z.string().max(512),
        providerId: z.string().min(1).max(128),
        status: z.enum(['active', 'needs_reauth', 'revoked']),
        active: z.boolean(),
      }),
      revision: z.number().int().nonnegative(),
      readPolicy: policySchema,
      writePolicy: policySchema,
      canAutoApprove: z.boolean(),
      tools: z
        .array(
          z.object({
            toolId: toolIdSchema,
            name: z.string().min(1).max(512),
            description: z.string().max(20_000),
            effect: z.enum(['read', 'write']),
            version: z.number().int().positive(),
            policy: policySchema,
            inherited: z.boolean(),
          })
        )
        .max(1000),
    }),
  },
})

const updatePermissionBodySchema = z
  .object({
    revision: z.number().int().nonnegative().max(2_147_483_646),
    change: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('group'),
          effect: z.enum(['read', 'write']),
          policy: policySchema,
        })
        .strict(),
      z
        .object({ kind: z.literal('tool'), toolId: toolIdSchema, policy: policySchema.nullable() })
        .strict(),
    ]),
  })
  .strict()

export const updateAssistantToolPermissionsContract = defineRouteContract({
  method: 'PATCH',
  path: permissionPath,
  params: permissionParamsSchema,
  body: updatePermissionBodySchema,
  response: { mode: 'json', schema: z.object({ revision: z.number().int().positive() }) },
})

export type AssistantToolPermissionsResponse = z.output<
  typeof readAssistantToolPermissionsContract.response.schema
>
export type UpdateAssistantToolPermissionsBody = z.input<typeof updatePermissionBodySchema>

const reviewParamsSchema = z.object({ id: organizationIdSchema, chatId: z.uuid() })
const reviewPath = '/api/organizations/[id]/chats/[chatId]/actions'
export const listAssistantActionsContract = defineRouteContract({
  method: 'GET',
  path: reviewPath,
  params: reviewParamsSchema,
  query: z.object({
    cursor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      actions: z
        .array(
          z.object({
            toolCallId: z.string().min(1).max(256),
            runId: z.uuid(),
            toolId: toolIdSchema,
            name: z.string().max(512),
            effect: z.enum(['read', 'write']),
            proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
            account: z
              .object({
                credentialId: z.string().max(128),
                displayName: z.string().max(512),
                providerId: z.string().max(128),
              })
              .nullable(),
            fields: z
              .array(
                z.object({
                  name: z.string().max(256),
                  label: z.string().max(512),
                  target: z.boolean(),
                  editable: z.boolean(),
                  format: z.enum(['text', 'multiline', 'json']),
                  value: z.string().max(ASSISTANT_REVIEW_FIELD_MAX_CHARS),
                })
              )
              .max(256),
          })
        )
        .max(32),
      nextCursor: z.number().int().nonnegative().nullable(),
    }),
  },
})

const decisionBodySchema = z
  .object({
    runId: z.uuid(),
    proposalVersion: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['allow', 'skip']),
    edits: z
      .record(z.string().min(1).max(256), z.string().max(ASSISTANT_REVIEW_FIELD_MAX_CHARS))
      .refine((value) => Object.keys(value).length <= 32, 'Too many edited fields')
      .optional(),
  })
  .strict()
export const decideAssistantActionContract = defineRouteContract({
  method: 'PATCH',
  path: `${reviewPath}/[toolCallId]`,
  params: reviewParamsSchema.extend({ toolCallId: z.string().min(1).max(256) }),
  body: decisionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      toolCallId: z.string().max(256),
      decision: z.enum(['allow', 'skip', 'allow_chat', 'always_allow']),
      applied: z.boolean(),
    }),
  },
})

export type AssistantActionsResponse = z.output<typeof listAssistantActionsContract.response.schema>
export type AssistantActionDecisionBody = z.input<typeof decisionBodySchema>
