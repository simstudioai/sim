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
})
export type DeployedChatConfig = z.output<typeof deployedChatConfigSchema>

export const deployedChatAuthBodySchema = z.object({
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
})
export type DeployedChatAuthBody = z.input<typeof deployedChatAuthBodySchema>

export const deployedChatFileSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  type: z.string().min(1, 'File type is required'),
  size: z.number().positive('File size must be positive'),
  data: z.string().min(1, 'File data is required'),
  lastModified: z.number().optional(),
})

export const deployedChatPostBodySchema = z.object({
  input: z.string().optional(),
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  conversationId: z.string().optional(),
  files: z.array(deployedChatFileSchema).optional().default([]),
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
    mode: 'json',
    schema: deployedChatConfigSchema,
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
