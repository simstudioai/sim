import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const formAuthTypeSchema = z.enum(['public', 'password', 'email'])
export type FormAuthType = z.output<typeof formAuthTypeSchema>

export const formIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const formStatusParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
})

export const formIdentifierValidationQuerySchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .max(100, 'Identifier must be 100 characters or less'),
})

export const formIdentifierParamsSchema = z.object({
  identifier: z.string().min(1),
})
export type FormIdentifierParams = z.output<typeof formIdentifierParamsSchema>

export const formSubmitBodySchema = z.object({
  formData: z.record(z.string(), z.unknown()).optional(),
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
})
export type FormSubmitBody = z.output<typeof formSubmitBodySchema>

export const formIdentifierValidationResponseSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable().optional(),
})

export const formFieldConfigSchema = z.object({
  name: z.string(),
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
})
export type FormFieldConfig = z.output<typeof formFieldConfigSchema>

export const formCustomizationsSchema = z.object({
  primaryColor: z.string().optional(),
  welcomeMessage: z.string().max(500, 'Welcome message must be 500 characters or less').optional(),
  thankYouTitle: z.string().max(100, 'Thank you title must be 100 characters or less').optional(),
  thankYouMessage: z
    .string()
    .max(500, 'Thank you message must be 500 characters or less')
    .optional(),
  logoUrl: z.string().url('Logo URL must be a valid URL').optional().or(z.literal('')),
  fieldConfigs: z.array(formFieldConfigSchema).optional(),
})
export type FormCustomizations = z.output<typeof formCustomizationsSchema>

export const existingFormSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  customizations: formCustomizationsSchema.nullable(),
  authType: formAuthTypeSchema,
  hasPassword: z.boolean(),
  allowedEmails: z.array(z.string()).nullable(),
  showBranding: z.boolean(),
  isActive: z.boolean(),
})
export type ExistingForm = z.output<typeof existingFormSchema>

export const formStatusResponseSchema = z.object({
  isDeployed: z.boolean(),
  form: z
    .object({
      id: z.string(),
      identifier: z.string().optional(),
      title: z.string().optional(),
      isActive: z.boolean().optional(),
    })
    .nullable(),
})
export type FormStatusResponse = z.output<typeof formStatusResponseSchema>

export const getFormDetailResponseSchema = z.object({
  form: existingFormSchema,
})

export const createFormBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(100, 'Identifier must be 100 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
  customizations: formCustomizationsSchema.optional(),
  authType: formAuthTypeSchema.default('public'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .optional()
    .or(z.literal('')),
  allowedEmails: z.array(z.string()).optional().default([]),
  showBranding: z.boolean().optional().default(true),
})
export type CreateFormInput = z.input<typeof createFormBodySchema>

export const updateFormBodySchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(100, 'Identifier must be 100 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or less')
    .optional(),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
  customizations: formCustomizationsSchema.optional(),
  authType: formAuthTypeSchema.optional(),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .optional()
    .or(z.literal('')),
  allowedEmails: z.array(z.string()).optional(),
  showBranding: z.boolean().optional(),
  isActive: z.boolean().optional(),
})
export type UpdateFormInput = z.input<typeof updateFormBodySchema>

export const createFormResponseSchema = z.object({
  id: z.string(),
  formUrl: z.string(),
  message: z.string(),
})
export type CreateFormResponse = z.output<typeof createFormResponseSchema>

export const formMutationResponseSchema = z.object({
  message: z.string(),
})

export const getFormStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/form/status',
  params: formStatusParamsSchema,
  response: {
    mode: 'json',
    schema: formStatusResponseSchema,
  },
})

export const getFormDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/form/manage/[id]',
  params: formIdParamsSchema,
  response: {
    mode: 'json',
    schema: getFormDetailResponseSchema,
  },
})

export const createFormContract = defineRouteContract({
  method: 'POST',
  path: '/api/form',
  body: createFormBodySchema,
  response: {
    mode: 'json',
    schema: createFormResponseSchema,
  },
})

export const updateFormContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/form/manage/[id]',
  params: formIdParamsSchema,
  body: updateFormBodySchema,
  response: {
    mode: 'json',
    schema: formMutationResponseSchema,
  },
})

export const deleteFormContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/form/manage/[id]',
  params: formIdParamsSchema,
  response: {
    mode: 'json',
    schema: formMutationResponseSchema,
  },
})

export const validateFormIdentifierContract = defineRouteContract({
  method: 'GET',
  path: '/api/form/validate',
  query: formIdentifierValidationQuerySchema,
  response: {
    mode: 'json',
    schema: formIdentifierValidationResponseSchema,
  },
})
