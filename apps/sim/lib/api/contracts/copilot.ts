import { z } from 'zod'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import { requiredFieldSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import {
  BILLING_ATTRIBUTION_HEADER,
  BILLING_ATTRIBUTION_HEADER_MAX_BYTES,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL_HEADER,
  COPILOT_BILLING_PROTOCOL_VALUES,
} from '@/lib/copilot/generated/billing-protocol-v1'
import { PERSISTED_RESOURCE_TYPES } from '@/lib/copilot/resources/types'

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

const copilotResourceTypeSchema = z.enum(PERSISTED_RESOURCE_TYPES)

const copilotChatResourceItemSchema = z
  .object({
    type: copilotResourceTypeSchema,
    id: requiredFieldSchema('resource.id cannot be empty'),
    title: z.string(),
    viewId: z.string().min(1).optional(),
  })
  .superRefine((resource, ctx) => {
    if (resource.viewId === undefined || resource.type === 'table') return
    ctx.addIssue({
      code: 'custom',
      path: ['viewId'],
      message: 'viewId is only valid for table resources',
    })
  })

export const addCopilotChatResourceBodySchema = z
  .object({
    chatId: requiredFieldSchema('chatId cannot be empty'),
    resource: copilotChatResourceItemSchema,
    clearViewId: z.literal(true).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.clearViewId !== true) return
    if (body.resource.type !== 'table') {
      ctx.addIssue({
        code: 'custom',
        path: ['clearViewId'],
        message: 'clearViewId is only valid for table resources',
      })
    }
    if (body.resource.viewId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['resource', 'viewId'],
        message: 'viewId must be omitted when clearViewId is true',
      })
    }
  })
export type AddCopilotChatResourceBody = z.input<typeof addCopilotChatResourceBodySchema>

export const removeCopilotChatResourceBodySchema = z.object({
  chatId: z.string(),
  resourceType: copilotResourceTypeSchema,
  resourceId: z.string(),
})
export type RemoveCopilotChatResourceBody = z.input<typeof removeCopilotChatResourceBodySchema>

export const reorderCopilotChatResourcesBodySchema = z.object({
  chatId: z.string(),
  resources: z.array(copilotChatResourceItemSchema),
})
export type ReorderCopilotChatResourcesBody = z.input<typeof reorderCopilotChatResourcesBodySchema>

export const copilotChatAbortBodySchema = z.object({
  streamId: z.string().optional(),
  chatId: z.string().optional(),
})
export type CopilotChatAbortBody = z.input<typeof copilotChatAbortBodySchema>

export const copilotToolExecuteInternalBodySchema = z
  .object({
    requestMode: z.enum(['assistant', 'agent', 'build', 'plan']).optional(),
    assistantSearch: workspaceSearchFiltersSchema.optional(),
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
        body.requestMode === 'assistant' &&
        Boolean(body.chatId)),
    {
      message:
        'Organization tools require Assistant mode and a private chat without workspace or workflow scope',
    }
  )
export type CopilotToolExecuteInternalBody = z.input<typeof copilotToolExecuteInternalBodySchema>

export const copilotChatGetQuerySchema = z
  .object({
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

export const copilotChatStreamQuerySchema = z.object({
  streamId: z.string().optional().default(''),
  after: z.string().optional().default(''),
  batch: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
})

const storedToolCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    state: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    result: z
      .object({
        success: z.boolean(),
        output: z.unknown().optional(),
        error: z.string().optional(),
      })
      .optional(),
    display: z
      .object({
        text: z.string().optional(),
        title: z.string().optional(),
        phaseLabel: z.string().optional(),
      })
      .optional(),
    calledBy: z.string().optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
  })
  .nullable()

const copilotContentBlockSchema = z.object({
  type: z.string(),
  lane: z.enum(['main', 'subagent']).optional(),
  content: z.string().optional(),
  channel: z.enum(['assistant', 'thinking']).optional(),
  phase: z.enum(['call', 'args_delta', 'result']).optional(),
  kind: z.enum(['subagent', 'structured_result', 'subagent_result']).optional(),
  lifecycle: z.enum(['start', 'end']).optional(),
  status: z.enum(['complete', 'error', 'cancelled']).optional(),
  parentToolCallId: z.string().optional(),
  toolCall: storedToolCallSchema.optional(),
  timestamp: z.number().optional(),
  endedAt: z.number().optional(),
})

export const copilotChatStopBodySchema = z.object({
  chatId: z.string(),
  streamId: z.string(),
  content: z.string(),
  contentBlocks: z.array(copilotContentBlockSchema).optional(),
  requestId: z.string().optional(),
})
export type CopilotChatStopBody = z.input<typeof copilotChatStopBodySchema>

export const deleteCopilotChatBodySchema = z.object({
  chatId: z.string(),
})
export type DeleteCopilotChatBody = z.input<typeof deleteCopilotChatBodySchema>

export const validateCopilotApiKeyHeadersSchema = z.object({
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

const copilotChatResourceSchema = z.object({
  type: copilotResourceTypeSchema,
  id: z.string(),
  title: z.string(),
  viewId: z.string().optional(),
})

const copilotChatGetChatSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    model: z.string().nullable(),
    messages: z.array(z.unknown()),
    messageCount: z.number(),
    config: z.unknown().nullable(),
    activeStreamId: z.string().nullable().optional(),
    resources: z.array(z.unknown()).optional(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    streamSnapshot: z
      .object({
        events: z.array(z.unknown()),
        previewSessions: z.array(z.unknown()),
        status: z.string(),
      })
      .optional(),
  })
  .passthrough()

const copilotChatGetListItemSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    model: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export const validateCopilotApiKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/api-keys/validate',
  headers: validateCopilotApiKeyHeadersSchema,
  body: validateCopilotApiKeyBodySchema,
  response: { mode: 'json', schema: validateCopilotApiKeyResponseSchema },
  error: validateCopilotApiKeyErrorSchema,
})

export const validateCopilotByokBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  userId: z.string().min(1, 'userId is required'),
})
export type ValidateCopilotByokBody = z.input<typeof validateCopilotByokBodySchema>

/**
 * Server-to-server entitlement gate called by the mothership (Go) before it
 * uses a workspace's own provider key. Empty 200/401/403 responses signal the
 * outcome; the Go caller fails closed to hosted keys on anything but a 200.
 */
export const validateCopilotByokContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/byok/validate',
  body: validateCopilotByokBodySchema,
  response: { mode: 'empty' },
})

export const listCopilotByokKeysQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
})
export type ListCopilotByokKeysQuery = z.input<typeof listCopilotByokKeysQuerySchema>

export const upsertCopilotByokKeyBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  provider: z.string().min(1, 'provider is required'),
  apiKey: z.string().min(1, 'apiKey is required'),
})
export type UpsertCopilotByokKeyBody = z.input<typeof upsertCopilotByokKeyBodySchema>

export const deleteCopilotByokKeyQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  provider: z.string().min(1, 'provider is required'),
})
export type DeleteCopilotByokKeyQuery = z.input<typeof deleteCopilotByokKeyQuerySchema>

/**
 * Superuser-gated proxies to the copilot's `/api/admin/byok` endpoints. The
 * responses are owned by the copilot service and forwarded verbatim.
 */
export const listCopilotByokKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/byok',
  query: listCopilotByokKeysQuerySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards the copilot /api/admin/byok response unchanged; shape is owned by the copilot service
    schema: z.unknown(),
  },
})

export const upsertCopilotByokKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/byok',
  body: upsertCopilotByokKeyBodySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards the copilot /api/admin/byok response unchanged; shape is owned by the copilot service
    schema: z.unknown(),
  },
})

export const deleteCopilotByokKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/byok',
  query: deleteCopilotByokKeyQuerySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards the copilot /api/admin/byok response unchanged; shape is owned by the copilot service
    schema: z.unknown(),
  },
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

export const addCopilotChatResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/chat/resources',
  body: addCopilotChatResourceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      resources: z.array(copilotChatResourceSchema).optional(),
    }),
  },
})

export const reorderCopilotChatResourcesContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/copilot/chat/resources',
  body: reorderCopilotChatResourcesBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      resources: z.array(copilotChatResourceSchema),
    }),
  },
})

export const removeCopilotChatResourceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/chat/resources',
  body: removeCopilotChatResourceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      resources: z.array(copilotChatResourceSchema),
    }),
  },
})

export const copilotChatStreamContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/chat/stream',
  query: copilotChatStreamQuerySchema,
  response: { mode: 'stream' },
})

export const copilotChatStopContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/chat/stop',
  body: copilotChatStopBodySchema,
  response: { mode: 'json', schema: successFlagSchema },
})

export const copilotChatGetContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/chat',
  query: copilotChatGetQuerySchema,
  response: {
    mode: 'json',
    schema: z.union([
      z.object({
        success: z.literal(true),
        chat: copilotChatGetChatSchema,
      }),
      z.object({
        success: z.literal(true),
        chats: z.array(copilotChatGetListItemSchema),
      }),
    ]),
  },
})

export const deleteCopilotChatContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/chat/delete',
  body: deleteCopilotChatBodySchema,
  response: { mode: 'json', schema: successFlagSchema },
})
