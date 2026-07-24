import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const chatAuthTypeSchema = z.enum(['public', 'password', 'email', 'sso'])
export type ChatAuthType = z.output<typeof chatAuthTypeSchema>

export const chatIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const chatIdentifierParamsSchema = z.object({
  identifier: z.string().min(1),
})

export const chatOutputConfigSchema = z.object({
  blockId: z.string().min(1),
  path: z.string().min(1),
})

export const deployedChatOutputConfigSchema = z.object({
  blockId: z.string(),
  path: z.string().optional(),
})

export const chatCustomizationsSchema = z.object({
  primaryColor: z.string(),
  welcomeMessage: z.string(),
  imageUrl: z.string().optional(),
})

export const createChatBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: chatCustomizationsSchema,
  authType: chatAuthTypeSchema.default('public'),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional().default([]),
  outputConfigs: z.array(chatOutputConfigSchema).optional().default([]),
  /** When true, clients may receive thinking SSE if they also send the protocol header. Default off. */
  includeThinking: z.boolean().optional().default(false),
  /** When true, clients may receive tool lifecycle SSE if they also send the protocol header. */
  includeToolCalls: z.boolean().optional().default(false),
})
export type CreateChatBody = z.input<typeof createChatBodySchema>

export const updateChatBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required').optional(),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  customizations: chatCustomizationsSchema.optional(),
  authType: chatAuthTypeSchema.optional(),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional(),
  outputConfigs: z.array(chatOutputConfigSchema).optional(),
  includeThinking: z.boolean().optional(),
  includeToolCalls: z.boolean().optional(),
})
export type UpdateChatBody = z.input<typeof updateChatBodySchema>

export const createChatResponseSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  chatUrl: z.string(),
  message: z.string(),
})
export type CreateChatResponse = z.output<typeof createChatResponseSchema>

export const updateChatResponseSchema = z.object({
  id: z.string(),
  chatUrl: z.string(),
  message: z.string(),
})
export type UpdateChatResponse = z.output<typeof updateChatResponseSchema>

export const deleteChatResponseSchema = z.object({
  message: z.string(),
})

export const deployedChatConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.preprocess((value) => value ?? '', z.string()),
  customizations: z.preprocess(
    (value) => value ?? {},
    z
      .object({
        primaryColor: z.string().optional(),
        logoUrl: z.string().optional(),
        imageUrl: z.string().optional(),
        welcomeMessage: z.string().optional(),
        headerText: z.string().optional(),
      })
      .passthrough()
  ),
  authType: z.preprocess((value) => value ?? 'public', chatAuthTypeSchema),
  outputConfigs: z.preprocess(
    (value) => value ?? undefined,
    z.array(deployedChatOutputConfigSchema).optional()
  ),
  /** Policy for thinking SSE; clients still need the X-Sim-Stream-Protocol opt-in. */
  includeThinking: z.preprocess((value) => value ?? false, z.boolean()),
  /** Policy for tool lifecycle SSE; clients still need the protocol opt-in. */
  includeToolCalls: z.preprocess((value) => value ?? false, z.boolean()),
})
export type DeployedChatConfig = z.output<typeof deployedChatConfigSchema>

export const deployedChatAuthBodySchema = z.object({
  password: z.string().max(1024, 'Password is too long').optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
})
export type DeployedChatAuthBody = z.input<typeof deployedChatAuthBodySchema>

const MAX_CHAT_INPUT_CHARS = 1_000_000
const MAX_CHAT_FILE_DATA_CHARS = 14 * 1024 * 1024
const MAX_CHAT_FILES = 15

export const deployedChatFileSchema = z.object({
  name: z.string().min(1, 'File name is required').max(255, 'File name is too long'),
  type: z.string().min(1, 'File type is required').max(255, 'File type is too long'),
  size: z.number().positive('File size must be positive'),
  data: z
    .string()
    .min(1, 'File data is required')
    .max(MAX_CHAT_FILE_DATA_CHARS, 'File data exceeds the maximum allowed size'),
  lastModified: z.number().optional(),
})

export const deployedChatPostBodySchema = z.object({
  input: z.string().max(MAX_CHAT_INPUT_CHARS, 'Input is too long').optional(),
  password: z.string().max(1024, 'Password is too long').optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  conversationId: z.string().max(256, 'Conversation ID is too long').optional(),
  files: z
    .array(deployedChatFileSchema)
    .max(MAX_CHAT_FILES, `A maximum of ${MAX_CHAT_FILES} files is allowed`)
    .optional()
    .default([]),
})
export type DeployedChatPostBody = z.input<typeof deployedChatPostBodySchema>

export const chatSSOBodySchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const chatSSOResponseSchema = z.object({
  eligible: z.boolean(),
})
export type ChatSSOResponse = z.output<typeof chatSSOResponseSchema>

export const chatEmailOtpRequestBodySchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const chatEmailOtpVerifyBodySchema = chatEmailOtpRequestBodySchema.extend({
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

export const chatEmailOtpRequestResponseSchema = z.object({
  message: z.string(),
})

export const identifierValidationQuerySchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .max(100, 'Identifier must be 100 characters or less'),
})

export const identifierValidationResponseSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable().optional(),
})

export const createChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/chat',
  body: createChatBodySchema,
  response: {
    mode: 'json',
    schema: createChatResponseSchema,
  },
})

export const getDeployedChatConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/chat/[identifier]',
  params: chatIdentifierParamsSchema,
  response: {
    mode: 'json',
    schema: deployedChatConfigSchema,
  },
})

export const authenticateDeployedChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/chat/[identifier]',
  params: chatIdentifierParamsSchema,
  body: deployedChatAuthBodySchema,
  response: {
    mode: 'json',
    schema: deployedChatConfigSchema,
  },
})

export const deployedChatPostContract = defineRouteContract({
  method: 'POST',
  path: '/api/chat/[identifier]',
  params: chatIdentifierParamsSchema,
  body: deployedChatPostBodySchema,
  response: {
    /**
     * Message posts return SSE (`text/event-stream`). Auth-only POSTs use
     * authenticateDeployedChatContract (JSON). Terminal frames: `final` or one
     * `error`, then `[DONE]`. Thinking and tool frames use independent deployment
     * policies; both require the protocol header.
     */
    mode: 'stream',
  },
})

export const chatSSOContract = defineRouteContract({
  method: 'POST',
  path: '/api/chat/[identifier]/sso',
  params: chatIdentifierParamsSchema,
  body: chatSSOBodySchema,
  response: {
    mode: 'json',
    schema: chatSSOResponseSchema,
  },
})

export const requestChatEmailOtpContract = defineRouteContract({
  method: 'POST',
  path: '/api/chat/[identifier]/otp',
  params: chatIdentifierParamsSchema,
  body: chatEmailOtpRequestBodySchema,
  response: {
    mode: 'json',
    schema: chatEmailOtpRequestResponseSchema,
  },
})

export const verifyChatEmailOtpContract = defineRouteContract({
  method: 'PUT',
  path: '/api/chat/[identifier]/otp',
  params: chatIdentifierParamsSchema,
  body: chatEmailOtpVerifyBodySchema,
  response: {
    mode: 'json',
    schema: deployedChatConfigSchema,
  },
})

export const validateChatIdentifierContract = defineRouteContract({
  method: 'GET',
  path: '/api/chat/validate',
  query: identifierValidationQuerySchema,
  response: {
    mode: 'json',
    schema: identifierValidationResponseSchema,
  },
})

export const updateChatContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/chat/manage/[id]',
  params: chatIdParamsSchema,
  body: updateChatBodySchema,
  response: {
    mode: 'json',
    schema: updateChatResponseSchema,
  },
})

export const deleteChatContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/chat/manage/[id]',
  params: chatIdParamsSchema,
  response: {
    mode: 'json',
    schema: deleteChatResponseSchema,
  },
})
