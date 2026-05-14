import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const dateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected a valid date string',
})

export const listMothershipChatsQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const mothershipChatParamsSchema = z.object({
  chatId: z.string().min(1),
})

export const updateMothershipChatBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    isUnread: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.isUnread !== undefined || data.pinned !== undefined,
    {
      message: 'At least one field must be provided',
    }
  )

export const createMothershipChatBodySchema = z.object({
  workspaceId: z.string().min(1),
})
export type CreateMothershipChatBody = z.input<typeof createMothershipChatBodySchema>

export const markMothershipChatReadBodySchema = z.object({
  chatId: z.string().min(1),
})
export type MarkMothershipChatReadBody = z.input<typeof markMothershipChatReadBodySchema>

export const markMothershipChatReadContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/read',
  body: markMothershipChatReadBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

const mothershipExecuteMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

const mothershipExecuteFileAttachmentSchema = z
  .object({
    type: z.enum(['text', 'image', 'document', 'audio', 'video']),
    source: z
      .object({
        type: z.literal('base64'),
        media_type: z.string().min(1),
        data: z.string().min(1),
      })
      .optional(),
    filename: z.string().optional(),
  })
  .passthrough()

export const mothershipExecuteBodySchema = z.object({
  messages: z.array(mothershipExecuteMessageSchema).min(1, 'At least one message is required'),
  responseFormat: z.any().optional(),
  workspaceId: z.string().min(1, 'workspaceId is required'),
  userId: z.string().min(1, 'userId is required'),
  chatId: z.string().optional(),
  messageId: z.string().optional(),
  requestId: z.string().optional(),
  fileAttachments: z.array(mothershipExecuteFileAttachmentSchema).optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
})
export type MothershipExecuteBody = z.input<typeof mothershipExecuteBodySchema>

export const mothershipEventsQuerySchema = z
  .object({
    workspaceId: z.string().optional(),
  })
  .passthrough()

export const mothershipChatGetQuerySchema = z
  .object({
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

export const mothershipChatPostEnvelopeSchema = z
  .object({
    message: z.string().optional(),
    chatId: z.string().optional(),
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough()

export const mothershipChatStopEnvelopeSchema = z
  .object({
    chatId: z.string().optional(),
    streamId: z.string().optional(),
    content: z.string().optional(),
    contentBlocks: z.array(z.unknown()).optional(),
    requestId: z.string().optional(),
  })
  .passthrough()

export const mothershipChatAbortEnvelopeSchema = z
  .object({
    streamId: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough()

export const mothershipChatStreamQuerySchema = z
  .object({
    streamId: z.string().optional(),
    after: z.string().optional(),
    batch: z.string().optional(),
  })
  .passthrough()

export const mothershipChatResourceEnvelopeSchema = z
  .object({ chatId: z.string().optional() })
  .passthrough()

export const adminMothershipQuerySchema = z
  .object({
    env: z.preprocess(
      (value) => (value === '' || value === undefined ? 'dev' : value),
      z.string().min(1).default('dev')
    ),
    endpoint: z.string().min(1, 'endpoint query param required'),
  })
  .passthrough()
export type AdminMothershipQuery = z.output<typeof adminMothershipQuerySchema>

const mothershipChatResourceItemSchema = z.object({
  type: z.string(),
  id: z.string(),
  title: z.string(),
})

const mothershipChatResourcesResponseSchema = z.object({
  success: z.literal(true),
  resources: z.array(mothershipChatResourceItemSchema),
})

const addMothershipChatResourceBodySchema = z.object({
  chatId: z.string().min(1),
  resource: mothershipChatResourceItemSchema,
})

const reorderMothershipChatResourcesBodySchema = z.object({
  chatId: z.string().min(1),
  resources: z.array(mothershipChatResourceItemSchema),
})

const removeMothershipChatResourceBodySchema = z.object({
  chatId: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
})

export const addMothershipChatResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chat/resources',
  body: addMothershipChatResourceBodySchema,
  response: {
    mode: 'json',
    schema: mothershipChatResourcesResponseSchema,
  },
})

export const reorderMothershipChatResourcesContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/mothership/chat/resources',
  body: reorderMothershipChatResourcesBodySchema,
  response: {
    mode: 'json',
    schema: mothershipChatResourcesResponseSchema,
  },
})

export const removeMothershipChatResourceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/mothership/chat/resources',
  body: removeMothershipChatResourceBodySchema,
  response: {
    mode: 'json',
    schema: mothershipChatResourcesResponseSchema,
  },
})

export const mothershipTaskSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updatedAt: dateStringSchema,
  activeStreamId: z.string().nullable(),
  lastSeenAt: dateStringSchema.nullable(),
  pinned: z.boolean(),
})

export const listMothershipChatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats',
  query: listMothershipChatsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.array(mothershipTaskSchema),
    }),
  },
})

export const updateMothershipChatContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/mothership/chats/[chatId]',
  params: mothershipChatParamsSchema,
  body: updateMothershipChatBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const deleteMothershipChatContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/mothership/chats/[chatId]',
  params: mothershipChatParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const forkMothershipChatBodySchema = z.object({
  upToMessageId: z.string().min(1, 'upToMessageId is required'),
})
export type ForkMothershipChatBody = z.input<typeof forkMothershipChatBodySchema>

export const forkMothershipChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/[chatId]/fork',
  params: mothershipChatParamsSchema,
  body: forkMothershipChatBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      id: z.string(),
    }),
  },
})

export const createMothershipChatResponseSchema = z.object({
  success: z.literal(true),
  id: z.string(),
})

export const mothershipExecuteResponseSchema = z
  .object({
    content: z.string().optional(),
    model: z.literal('mothership'),
    conversationId: z.string(),
    tokens: z
      .object({
        prompt: z.number().optional(),
        completion: z.number().optional(),
        total: z.number().optional(),
      })
      .passthrough(),
    cost: z.unknown().optional(),
    toolCalls: z.array(z.unknown()).optional(),
  })
  .passthrough()

const mothershipChatStreamSnapshotSchema = z
  .object({
    events: z.array(z.unknown()),
    previewSessions: z.array(z.unknown()),
    status: z.string(),
  })
  .passthrough()

export const getMothershipChatResponseSchema = z.object({
  success: z.literal(true),
  chat: z
    .object({
      id: z.string(),
      title: z.string().nullable(),
      messages: z.array(z.unknown()),
      activeStreamId: z.string().nullable(),
      resources: z.array(z.unknown()),
      createdAt: z.union([z.string(), z.date()]).nullable().optional(),
      updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
      streamSnapshot: mothershipChatStreamSnapshotSchema.optional(),
    })
    .passthrough(),
})

export const createMothershipChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats',
  body: createMothershipChatBodySchema,
  response: {
    mode: 'json',
    schema: createMothershipChatResponseSchema,
  },
})

export const mothershipExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/execute',
  body: mothershipExecuteBodySchema,
  response: {
    mode: 'json',
    schema: mothershipExecuteResponseSchema,
  },
})

export const getMothershipChatContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]',
  params: mothershipChatParamsSchema,
  response: {
    mode: 'json',
    schema: getMothershipChatResponseSchema,
  },
})

export type MothershipTask = z.infer<typeof mothershipTaskSchema>
