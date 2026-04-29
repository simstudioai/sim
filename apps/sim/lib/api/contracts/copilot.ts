import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/constants'

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

export const v1CopilotChatBodySchema = z.object({
  message: z.string().min(1, 'message is required'),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  chatId: z.string().optional(),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  model: z.string().optional(),
  autoExecuteTools: z.boolean().optional().default(true),
  timeout: z.number().optional().default(3_600_000),
})

export type V1CopilotChatBody = z.output<typeof v1CopilotChatBodySchema>

export const copilotCredentialsQuerySchema = z.object({}).passthrough()

export const copilotConfirmBodySchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  status: z.enum(
    Object.values(ASYNC_TOOL_CONFIRMATION_STATUS) as [
      AsyncConfirmationStatus,
      ...AsyncConfirmationStatus[],
    ]
  ),
  message: z.string().optional(),
  data: z.unknown().optional(),
})
export type CopilotConfirmBody = z.input<typeof copilotConfirmBodySchema>

export const createWorkflowCopilotChatBodySchema = z.object({
  workspaceId: z.string().min(1),
  workflowId: z.string().min(1),
})
export type CreateWorkflowCopilotChatBody = z.input<typeof createWorkflowCopilotChatBodySchema>

export const copilotStatsBodySchema = z.object({
  messageId: z.string(),
  diffCreated: z.boolean(),
  diffAccepted: z.boolean(),
})
export type CopilotStatsBody = z.input<typeof copilotStatsBodySchema>

export const copilotTrainingExampleBodySchema = z.object({
  json: z.string().min(1, 'JSON string is required'),
  title: z.string().min(1, 'Title is required'),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CopilotTrainingExampleBody = z.input<typeof copilotTrainingExampleBodySchema>

const copilotTrainingOperationSchema = z.object({
  operation_type: z.string(),
  block_id: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

export const copilotTrainingDataBodySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  operations: z.array(copilotTrainingOperationSchema),
})
export type CopilotTrainingDataBody = z.input<typeof copilotTrainingDataBodySchema>

export const renameCopilotChatBodySchema = z.object({
  chatId: z.string().min(1),
  title: z.string().min(1).max(200),
})
export type RenameCopilotChatBody = z.input<typeof renameCopilotChatBodySchema>

export const copilotToolPreferenceBodySchema = z.object({
  toolId: z.string().min(1),
})
export type CopilotToolPreferenceBody = z.input<typeof copilotToolPreferenceBodySchema>

export const copilotToolPreferenceQuerySchema = z.object({
  toolId: z.string().min(1),
})
export type CopilotToolPreferenceQuery = z.input<typeof copilotToolPreferenceQuerySchema>

const copilotResourceTypeSchema = z.enum([
  'table',
  'file',
  'workflow',
  'knowledgebase',
  'folder',
  'log',
])

export const addCopilotChatResourceBodySchema = z.object({
  chatId: z.string(),
  resource: z.object({
    type: copilotResourceTypeSchema,
    id: z.string(),
    title: z.string(),
  }),
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
  resources: z.array(
    z.object({
      type: copilotResourceTypeSchema,
      id: z.string(),
      title: z.string(),
    })
  ),
})
export type ReorderCopilotChatResourcesBody = z.input<typeof reorderCopilotChatResourcesBodySchema>

export const revertCopilotCheckpointBodySchema = z.object({
  checkpointId: z.string().min(1),
})
export type RevertCopilotCheckpointBody = z.input<typeof revertCopilotCheckpointBodySchema>

export const copilotChatAbortBodySchema = z.object({
  streamId: z.string().optional(),
  chatId: z.string().optional(),
})
export type CopilotChatAbortBody = z.input<typeof copilotChatAbortBodySchema>

export const copilotChatGetQuerySchema = z
  .object({
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

export const copilotModelsQuerySchema = z.object({}).passthrough()

export const createCopilotCheckpointBodySchema = z.object({
  workflowId: z.string(),
  chatId: z.string(),
  messageId: z.string().optional(),
  workflowState: z.string(),
})
export type CreateCopilotCheckpointBody = z.input<typeof createCopilotCheckpointBodySchema>

export const listCopilotCheckpointsQuerySchema = z.object({
  chatId: z.string({ error: 'chatId is required' }).min(1, 'chatId is required'),
})
export type ListCopilotCheckpointsQuery = z.input<typeof listCopilotCheckpointsQuerySchema>

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

export const updateCopilotMessagesBodySchema = z.object({
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
export type UpdateCopilotMessagesBody = z.input<typeof updateCopilotMessagesBodySchema>

export const validateCopilotApiKeyBodySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})
export type ValidateCopilotApiKeyBody = z.input<typeof validateCopilotApiKeyBodySchema>

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

export const v1CopilotChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/copilot/chat',
  body: v1CopilotChatBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({
        success: z.boolean(),
        content: z.unknown().optional(),
        toolCalls: z.unknown().optional(),
        chatId: z.string().optional(),
        error: z.string().optional(),
      })
      .passthrough(),
  },
})
