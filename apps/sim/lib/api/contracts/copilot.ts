import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { cleanedWorkflowStateSchema } from '@/lib/api/contracts/workflows'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'

const copilotApiKeySchema = z.object({
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

const generateCopilotApiKeyBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
})

const submitCopilotFeedbackBodySchema = z.object({
  chatId: z.string().uuid('Chat ID must be a valid UUID'),
  userQuery: z.string().min(1, 'User query is required'),
  agentResponse: z.string().min(1, 'Agent response is required'),
  isPositiveFeedback: z.boolean(),
  feedback: z.string().optional(),
  workflowYaml: z.string().optional(),
})

export type SubmitCopilotFeedbackBody = z.input<typeof submitCopilotFeedbackBodySchema>

const copilotCredentialsQuerySchema = z.object({})

const copilotConfirmBodySchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
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
type CopilotConfirmBody = z.input<typeof copilotConfirmBodySchema>

const createWorkflowCopilotChatBodySchema = z.object({
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
})
type CreateWorkflowCopilotChatBody = z.input<typeof createWorkflowCopilotChatBodySchema>

const copilotStatsBodySchema = z.object({
  messageId: z.string(),
  diffCreated: z.boolean(),
  diffAccepted: z.boolean(),
})
type CopilotStatsBody = z.input<typeof copilotStatsBodySchema>

const copilotTrainingExampleBodySchema = z.object({
  json: z.string().min(1, 'JSON string is required'),
  title: z.string().min(1, 'Title is required'),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
type CopilotTrainingExampleBody = z.input<typeof copilotTrainingExampleBodySchema>

const copilotTrainingOperationSchema = z.object({
  operation_type: z.string(),
  block_id: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

const copilotTrainingDataBodySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  operations: z.array(copilotTrainingOperationSchema),
})
type CopilotTrainingDataBody = z.input<typeof copilotTrainingDataBodySchema>

const renameCopilotChatBodySchema = z.object({
  chatId: z.string().min(1),
  title: z.string().min(1).max(200),
})
type RenameCopilotChatBody = z.input<typeof renameCopilotChatBodySchema>

const copilotToolPreferenceBodySchema = z.object({
  toolId: z.string().min(1),
})
type CopilotToolPreferenceBody = z.input<typeof copilotToolPreferenceBodySchema>

const copilotToolPreferenceQuerySchema = z.object({
  toolId: z.string().min(1),
})
type CopilotToolPreferenceQuery = z.input<typeof copilotToolPreferenceQuerySchema>

const copilotResourceTypeSchema = z.enum([
  'table',
  'file',
  'workflow',
  'knowledgebase',
  'folder',
  'log',
])

const addCopilotChatResourceBodySchema = z.object({
  chatId: z.string(),
  resource: z.object({
    type: copilotResourceTypeSchema,
    id: z.string(),
    title: z.string(),
  }),
})
type AddCopilotChatResourceBody = z.input<typeof addCopilotChatResourceBodySchema>

const removeCopilotChatResourceBodySchema = z.object({
  chatId: z.string(),
  resourceType: copilotResourceTypeSchema,
  resourceId: z.string(),
})
type RemoveCopilotChatResourceBody = z.input<typeof removeCopilotChatResourceBodySchema>

const reorderCopilotChatResourcesBodySchema = z.object({
  chatId: z.string(),
  resources: z.array(
    z.object({
      type: copilotResourceTypeSchema,
      id: z.string(),
      title: z.string(),
    })
  ),
})
type ReorderCopilotChatResourcesBody = z.input<typeof reorderCopilotChatResourcesBodySchema>

const revertCopilotCheckpointBodySchema = z.object({
  checkpointId: z.string().min(1),
})
type RevertCopilotCheckpointBody = z.input<typeof revertCopilotCheckpointBodySchema>

export const copilotChatAbortBodySchema = z.object({
  streamId: z.string().optional(),
  chatId: z.string().optional(),
})
type CopilotChatAbortBody = z.input<typeof copilotChatAbortBodySchema>

const copilotChatGetQuerySchema = z
  .object({
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

const copilotModelsQuerySchema = z.object({})

const createCopilotCheckpointBodySchema = z.object({
  workflowId: z.string(),
  chatId: z.string(),
  messageId: z.string().optional(),
  workflowState: z.string(),
})
type CreateCopilotCheckpointBody = z.input<typeof createCopilotCheckpointBodySchema>

const listCopilotCheckpointsQuerySchema = z.object({
  chatId: z.string({ error: 'chatId is required' }).min(1, 'chatId is required'),
})
type ListCopilotCheckpointsQuery = z.input<typeof listCopilotCheckpointsQuerySchema>

const copilotChatStreamQuerySchema = z.object({
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

const copilotChatStopBodySchema = z.object({
  chatId: z.string(),
  streamId: z.string(),
  content: z.string(),
  contentBlocks: z.array(copilotContentBlockSchema).optional(),
  requestId: z.string().optional(),
})
type CopilotChatStopBody = z.input<typeof copilotChatStopBodySchema>

const deleteCopilotChatBodySchema = z.object({
  chatId: z.string(),
})
type DeleteCopilotChatBody = z.input<typeof deleteCopilotChatBodySchema>

const copilotPersistedMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string(),
    toolCalls: z.array(z.any()).optional(),
    contentBlocks: z.array(z.any()).optional(),
    fileAttachments: z
      .array(
        z.object({
          id: z.string(),
          key: z.string(),
          filename: z.string(),
          media_type: z.string(),
          size: z.number(),
        })
      )
      .optional(),
    contexts: z.array(z.any()).optional(),
    citations: z.array(z.any()).optional(),
    errorType: z.string().optional(),
  })
  .passthrough()

const updateCopilotMessagesBodySchema = z.object({
  chatId: z.string(),
  messages: z.array(copilotPersistedMessageSchema),
  planArtifact: z.string().nullable().optional(),
  config: z
    .object({
      mode: z.string().optional(),
      model: z.string().optional(),
    })
    .nullable()
    .optional(),
})
type UpdateCopilotMessagesBody = z.input<typeof updateCopilotMessagesBodySchema>

const validateCopilotApiKeyBodySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})
type ValidateCopilotApiKeyBody = z.input<typeof validateCopilotApiKeyBodySchema>

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

const copilotChatListItemSchema = z.object({
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

const copilotCheckpointSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workflowId: z.string(),
  chatId: z.string(),
  messageId: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const copilotChatResourceSchema = z.object({
  type: copilotResourceTypeSchema,
  id: z.string(),
  title: z.string(),
})

const copilotAvailableModelSchema = z.object({
  id: z.string(),
  friendlyName: z.string(),
  provider: z.string(),
})

const copilotChatGetChatSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    model: z.string().nullable(),
    messages: z.array(z.unknown()),
    messageCount: z.number(),
    planArtifact: z.unknown().nullable(),
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
    messages: z.array(z.unknown()),
    messageCount: z.number(),
    planArtifact: z.unknown().nullable(),
    config: z.unknown().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

const copilotConnectedCredentialSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  serviceName: z.string(),
  lastUsed: z.string(),
  isDefault: z.boolean(),
  accessToken: z.string().nullable(),
})

const copilotNotConnectedServiceSchema = z.object({
  providerId: z.string(),
  name: z.string(),
  description: z.string(),
  baseProvider: z.string(),
})

const copilotCredentialsResultSchema = z.object({
  oauth: z.object({
    connected: z.object({
      credentials: z.array(copilotConnectedCredentialSchema),
      total: z.number(),
    }),
    notConnected: z.object({
      services: z.array(copilotNotConnectedServiceSchema),
      total: z.number(),
    }),
  }),
  environment: z.object({
    variableNames: z.array(z.string()),
    count: z.number(),
    personalVariables: z.array(z.string()),
    workspaceVariables: z.array(z.string()),
    conflicts: z.array(z.string()),
  }),
})

export const copilotCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/credentials',
  query: copilotCredentialsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      result: copilotCredentialsResultSchema,
    }),
  },
})

export const copilotStatsContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/stats',
  body: copilotStatsBodySchema,
  response: { mode: 'json', schema: successFlagSchema },
})

export const validateCopilotApiKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/api-keys/validate',
  body: validateCopilotApiKeyBodySchema,
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

export const createCopilotCheckpointContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/checkpoints',
  body: createCopilotCheckpointBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      checkpoint: copilotCheckpointSchema,
    }),
  },
})

export const listCopilotCheckpointsContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/checkpoints',
  query: listCopilotCheckpointsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      checkpoints: z.array(copilotCheckpointSchema),
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

export const copilotModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/copilot/models',
  query: copilotModelsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      models: z.array(copilotAvailableModelSchema),
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

/**
 * Forwards the agent indexer's free-form JSON response.
 * Shape varies by upstream version.
 */
export const copilotTrainingDataContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/training',
  body: copilotTrainingDataBodySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards external agent indexer /operations/add response unchanged; shape varies by upstream version
    schema: z.unknown(),
  },
})

/**
 * Forwards the agent indexer's free-form JSON response.
 * Shape varies by upstream version.
 */
export const copilotTrainingExampleContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/training/examples',
  body: copilotTrainingExampleBodySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards external agent indexer /examples/add response unchanged; shape varies by upstream version
    schema: z.unknown(),
  },
})

export const renameCopilotChatContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/copilot/chat/rename',
  body: renameCopilotChatBodySchema,
  response: { mode: 'json', schema: successFlagSchema },
})

export const addCopilotAutoAllowedToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/auto-allowed-tools',
  body: copilotToolPreferenceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      autoAllowedTools: z.array(z.string()),
    }),
  },
})

export const removeCopilotAutoAllowedToolContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/copilot/auto-allowed-tools',
  query: copilotToolPreferenceQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      autoAllowedTools: z.array(z.string()),
    }),
  },
})

export const revertCopilotCheckpointContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/checkpoints/revert',
  body: revertCopilotCheckpointBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      workflowId: z.string(),
      checkpointId: z.string(),
      revertedAt: z.string(),
      checkpoint: z.object({
        id: z.string(),
        workflowState: cleanedWorkflowStateSchema,
      }),
    }),
  },
})

const copilotChatAbortContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/chat/abort',
  body: copilotChatAbortBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      aborted: z.boolean(),
      settled: z.boolean().optional(),
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

export const updateCopilotMessagesContract = defineRouteContract({
  method: 'POST',
  path: '/api/copilot/chat/update-messages',
  body: updateCopilotMessagesBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      messageCount: z.number(),
    }),
  },
})
