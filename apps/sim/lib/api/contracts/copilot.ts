import { z } from 'zod'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { usageUpgradePayloadSchema } from '@/lib/api/contracts/subscription'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  BILLING_ACCOUNT_DECISION_HEADER,
  BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES,
  BILLING_ATTRIBUTION_HEADER,
  BILLING_ATTRIBUTION_HEADER_MAX_BYTES,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL_HEADER,
  COPILOT_BILLING_PROTOCOL_VALUES,
  COPILOT_VALIDATION_PURPOSE,
  COPILOT_VALIDATION_PURPOSE_VALUES,
} from '@/lib/mothership/generated/billing-protocol-v1'

export const copilotApiKeySchema = z.object({
  id: z.string(),
  displayKey: z.string(),
  name: z.string().nullable(),
  createdAt: z.string().nullable(),
  lastUsed: z.string().nullable(),
})

export type CopilotApiKey = z.output<typeof copilotApiKeySchema>

export const deleteCopilotApiKeyQuerySchema = z.object({
  id: z.string().min(1),
})

export const generateCopilotApiKeyBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
})

export const submitCopilotFeedbackBodySchema = z.object({
  chatId: z.string().uuid('Chat ID must be a valid UUID'),
  userQuery: z.string().min(1, 'User query is required'),
  agentResponse: z.string().min(1, 'Agent response is required'),
  isPositiveFeedback: z.boolean(),
  feedback: z.string().optional(),
  workflowYaml: z.string().optional(),
})

export type SubmitCopilotFeedbackBody = z.input<typeof submitCopilotFeedbackBodySchema>

export const copilotConfirmBodySchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  executionId: z.string().min(1, 'Execution ID is required').max(255).optional(),
  status: z.enum(
    Object.values(ASYNC_TOOL_CONFIRMATION_STATUS) as [
      AsyncConfirmationStatus,
      ...AsyncConfirmationStatus[],
    ],
    { error: 'Invalid notification status' }
  ),
  message: z.string().optional(),
  data: z.unknown().optional(),
})
export type CopilotConfirmBody = z.input<typeof copilotConfirmBodySchema>

export const copilotToolPermissionDecisionSchema = z.enum([
  'allow',
  'allow_chat',
  'always_allow',
  'skip',
])

/**
 * Decisions arrive as a batch so "Allow all" on a turn that gated several
 * tools at once is a single round trip rather than one request per card.
 */
export const copilotToolPermissionBodySchema = z.object({
  decisions: z
    .array(
      z.object({
        toolCallId: z.string().min(1, 'Tool call ID is required'),
        decision: copilotToolPermissionDecisionSchema,
      })
    )
    .min(1, 'At least one decision is required')
    .max(50, 'Too many decisions in one request'),
})
export type CopilotToolPermissionBody = z.input<typeof copilotToolPermissionBodySchema>

export const createWorkflowCopilotChatBodySchema = z.object({
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
})
export type CreateWorkflowCopilotChatBody = z.input<typeof createWorkflowCopilotChatBodySchema>

export const copilotChatSteerBodySchema = z.object({
  streamId: z.string().min(1, 'streamId is required'),
  chatId: z.string().min(1, 'chatId is required'),
  steeringId: z.string().min(1, 'steeringId is required'),
  content: z.string().min(1, 'content is required').max(32_768, 'content is too long'),
})
export type CopilotChatSteerBody = z.input<typeof copilotChatSteerBodySchema>

export const copilotToolExecuteInternalBodySchema = z
  .object({
    requestMode: z.enum(['assistant', 'agent', 'build', 'plan']).optional(),
    assistantSearch: workspaceSearchFiltersSchema.optional(),
    targetWorkspaceId: workspaceIdSchema.optional(),
    toolCallId: z.string().min(1, 'toolCallId is required'),
    toolName: z.string().min(1, 'toolName is required'),
    params: z.record(z.string(), z.unknown()).default({}),
    userId: z.string().min(1, 'userId is required'),
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    organizationId: z.string().min(1).max(200).optional(),
    chatId: z.string().optional(),
    messageId: z.string().optional(),
    parentToolCallId: z.string().optional(),
    userPermission: z.string().optional(),
  })
  .refine(
    (body) =>
      !body.organizationId ||
      (!body.workspaceId &&
        !body.workflowId &&
        (body.requestMode === 'assistant' || body.requestMode === 'agent') &&
        Boolean(body.chatId)),
    {
      message:
        'Organization tools require an explicit mode and a private chat without workspace or workflow owner scope',
    }
  )
export type CopilotToolExecuteInternalBody = z.input<typeof copilotToolExecuteInternalBodySchema>

export const deleteCopilotChatBodySchema = z.object({
  chatId: z.string(),
})
export type DeleteCopilotChatBody = z.input<typeof deleteCopilotChatBodySchema>

export const validateCopilotApiKeyHeadersSchema = z.object({
  [BILLING_ACCOUNT_DECISION_HEADER]: z
    .string()
    .max(BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES)
    .optional(),
  [COPILOT_BILLING_PROTOCOL_HEADER]: z.enum(COPILOT_BILLING_PROTOCOL_VALUES).optional(),
  [BILLING_REQUEST_ID_HEADER]: z.string().uuid().optional(),
  [BILLING_ATTRIBUTION_HEADER]: z.string().max(BILLING_ATTRIBUTION_HEADER_MAX_BYTES).optional(),
})

export const validateCopilotApiKeyErrorSchema = z
  .object({
    error: z.string().min(1).max(500),
    details: z.array(z.unknown()).optional(),
  })
  .strict()
export type ValidateCopilotApiKeyError = z.output<typeof validateCopilotApiKeyErrorSchema>

export const validateCopilotApiKeyBodySchema = z
  .object({
    userId: z.string().min(1, 'userId is required'),
    /** Selected by the authenticated worker, never by public callers. */
    purpose: z.enum(COPILOT_VALIDATION_PURPOSE_VALUES).default(COPILOT_VALIDATION_PURPOSE.newTurn),
    /**
     * Originating execution workspace. Hosted attribution-v1 binds it to Sim's
     * immutable payer snapshot. Markerless legacy-v0 resolves a locally known
     * workspace's current payer for aligned payer-pool and member admission.
     * For direct-v1 Chat/Copilot API keys it may be a self-hosted local ID and is
     * never used to select or authorize a hosted payer, so direct-v1 callers may
     * omit it entirely.
     */
    workspaceId: z.string().min(1).optional(),
    organizationId: z.string().min(1).max(200).optional(),
    chatId: z.string().min(1).max(200).optional(),
  })
  .refine((body) => !(body.workspaceId && body.organizationId), {
    message: 'workspaceId and organizationId are mutually exclusive',
  })
export type ValidateCopilotApiKeyBody = z.input<typeof validateCopilotApiKeyBodySchema>

export const validateCopilotApiKeyResponseSchema = z.object({
  /**
   * Server-derived entitlement for the validated key owner. Mothership treats
   * a missing or false value as ineligible for enterprise-only capabilities.
   */
  isEnterprise: z.boolean(),
})
export type ValidateCopilotApiKeyResponse = z.output<typeof validateCopilotApiKeyResponseSchema>

export const COPILOT_USAGE_LIMIT_EXCEEDED_CODE = 'USAGE_LIMIT_EXCEEDED'
export const COPILOT_BILLING_BLOCKED_CODE = 'BILLING_BLOCKED'

/**
 * A continuation refused because the run's original payer is over its usage limit. A worker
 * polling continuation validation mid-run writes `usageUpgrade` as a `<usage_upgrade>` tag into
 * its log and pauses the run for the limit.
 */
export const validateCopilotApiKeyUsageExceededSchema = z.object({
  code: z.literal(COPILOT_USAGE_LIMIT_EXCEEDED_CODE),
  error: z.string(),
  usageUpgrade: usageUpgradePayloadSchema,
})
export type ValidateCopilotApiKeyUsageExceeded = z.output<
  typeof validateCopilotApiKeyUsageExceededSchema
>

/** A continuation refused because the actor or payer account is blocked (payment, dispute). */
export const validateCopilotApiKeyBillingBlockedSchema = z.object({
  code: z.literal(COPILOT_BILLING_BLOCKED_CODE),
  error: z.string(),
})
export type ValidateCopilotApiKeyBillingBlocked = z.output<
  typeof validateCopilotApiKeyBillingBlockedSchema
>

/** A continuation 402 carries one of these bodies; a new turn's 402 is empty. */
export const validateCopilotApiKeyRefusalSchema = z.union([
  validateCopilotApiKeyUsageExceededSchema,
  validateCopilotApiKeyBillingBlockedSchema,
])

export const listCopilotApiKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/api-keys',
  response: {
    mode: 'json',
    schema: z.object({
      keys: z.array(copilotApiKeySchema),
    }),
  },
})

export const copilotChatListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  workflowId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  activeStreamId: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type CopilotChatListItem = z.output<typeof copilotChatListItemSchema>

export const listCopilotChatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/chats',
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      chats: z.array(copilotChatListItemSchema),
    }),
  },
})

export const generateCopilotApiKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/api-keys/generate',
  body: generateCopilotApiKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      key: z.object({
        id: z.string(),
        apiKey: z.string(),
      }),
    }),
  },
})

export type GenerateCopilotApiKeyResult = ContractJsonResponse<typeof generateCopilotApiKeyContract>

export const deleteCopilotApiKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/api-keys',
  query: deleteCopilotApiKeyQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const submitCopilotFeedbackContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/feedback',
  body: submitCopilotFeedbackBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      feedbackId: z.string(),
      message: z.string(),
      metadata: z.object({
        requestId: z.string(),
        duration: z.number(),
      }),
    }),
  },
})

export type SubmitCopilotFeedbackResult = ContractJsonResponse<typeof submitCopilotFeedbackContract>

const successFlagSchema = z.object({ success: z.literal(true) })

export const validateCopilotApiKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/api-keys/validate',
  headers: validateCopilotApiKeyHeadersSchema,
  body: validateCopilotApiKeyBodySchema,
  response: {
    mode: 'json',
    schema: validateCopilotApiKeyResponseSchema,
    status: [200, 402],
    statusSchemas: {
      200: validateCopilotApiKeyResponseSchema,
      402: validateCopilotApiKeyRefusalSchema.optional(),
    },
  },
  error: validateCopilotApiKeyErrorSchema,
})

export const validateCopilotByokBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  userId: z.string().min(1, 'userId is required'),
})
export type ValidateCopilotByokBody = z.input<typeof validateCopilotByokBodySchema>

/**
 * Server-to-server entitlement gate called by the mothership worker before it
 * uses a workspace's own provider key. Empty 200/401/403 responses signal the
 * outcome; the caller fails closed to hosted keys on anything but a 200.
 */
export const validateCopilotByokContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/byok/validate',
  body: validateCopilotByokBodySchema,
  response: { mode: 'empty' },
})

export const createWorkflowCopilotChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/chats',
  body: createWorkflowCopilotChatBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      id: z.string(),
    }),
  },
})

export const copilotConfirmContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/confirm',
  body: copilotConfirmBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      message: z.string(),
      toolCallId: z.string(),
      status: z.string(),
    }),
  },
})

export const copilotToolPermissionContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/tool-permission',
  body: copilotToolPermissionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      // Echoes the decision that actually stuck per tool call, which can differ
      // from what was sent when another tab answered the same prompt first.
      results: z.array(
        z.object({
          toolCallId: z.string(),
          decision: copilotToolPermissionDecisionSchema,
          applied: z.boolean(),
        })
      ),
    }),
  },
})

export const deleteCopilotChatContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/chat/delete',
  body: deleteCopilotChatBodySchema,
  response: { mode: 'json', schema: successFlagSchema },
})

export const copilotChatSteerContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/chat/steer',
  body: copilotChatSteerBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ ok: z.boolean(), queued: z.boolean(), workerStatus: z.number().optional() }),
  },
})
