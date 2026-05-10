import { z } from 'zod'
import { booleanQueryFlagSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const booleanQuerySchema = booleanQueryFlagSchema.optional().default(false)

export const templateStatusSchema = z.enum(['pending', 'approved', 'rejected'])

export const templateIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const templateDetailsSchema = z.object({
  tagline: z.string().optional(),
  about: z.string().optional(),
})

export const templateCreatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  referenceType: z.enum(['user', 'organization']),
  referenceId: z.string(),
  profileImageUrl: z.string().nullable(),
  verified: z.boolean(),
  details: z
    .object({
      about: z.string().optional(),
      xUrl: z.string().optional(),
      linkedinUrl: z.string().optional(),
      websiteUrl: z.string().optional(),
      contactEmail: z.string().optional(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type TemplateCreator = z.output<typeof templateCreatorSchema>

export const templateSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  name: z.string(),
  details: templateDetailsSchema.nullable().optional(),
  creatorId: z.string().nullable().optional(),
  creator: templateCreatorSchema.nullish(),
  views: z.number(),
  stars: z.number(),
  status: templateStatusSchema,
  tags: z.array(z.string()),
  requiredCredentials: z.unknown(),
  state: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isStarred: z.boolean().optional(),
  isSuperUser: z.boolean().optional(),
})
export type TemplateContractData = z.output<typeof templateSchema>

export const templateListQuerySchema = z.object({
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
  search: z.string().optional(),
  workflowId: z.string().optional(),
  status: templateStatusSchema.optional(),
  includeAllStatuses: booleanQuerySchema,
})
export type TemplateListFilters = z.input<typeof templateListQuerySchema>

export const templatesResponseSchema = z.object({
  data: z.array(templateSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    page: z.number(),
    totalPages: z.number(),
  }),
})
export type TemplatesContractResponse = z.output<typeof templatesResponseSchema>

export const templateDetailResponseSchema = z.object({
  data: templateSchema,
})
export type TemplateDetailContractResponse = z.output<typeof templateDetailResponseSchema>

export const createTemplateBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  details: templateDetailsSchema.optional(),
  creatorId: z.string().min(1, 'Creator profile is required'),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional().default([]),
})
export type CreateTemplateInput = z.input<typeof createTemplateBodySchema>

export const createTemplateResponseSchema = z.object({
  id: z.string(),
  message: z.string(),
})

export const updateTemplateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  details: templateDetailsSchema.optional(),
  creatorId: z.string().optional(),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional(),
  updateState: z.boolean().optional(),
  status: templateStatusSchema.optional(),
})
export type UpdateTemplateInput = z.input<typeof updateTemplateBodySchema>

export const updateTemplateResponseSchema = z.object({
  data: templateSchema,
  message: z.string(),
})

export const deleteTemplateResponseSchema = z.object({
  success: z.literal(true),
})

export const templateStarResponseSchema = z.object({
  message: z.string(),
})

export const listTemplatesContract = defineRouteContract({
  method: 'GET',
  path: '/api/templates',
  query: templateListQuerySchema,
  response: {
    mode: 'json',
    schema: templatesResponseSchema,
  },
})

export const createTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/templates',
  body: createTemplateBodySchema,
  response: {
    mode: 'json',
    schema: createTemplateResponseSchema,
  },
})

export const getTemplateContract = defineRouteContract({
  method: 'GET',
  path: '/api/templates/[id]',
  params: templateIdParamsSchema,
  response: {
    mode: 'json',
    schema: templateDetailResponseSchema,
  },
})

export const updateTemplateContract = defineRouteContract({
  method: 'PUT',
  path: '/api/templates/[id]',
  params: templateIdParamsSchema,
  body: updateTemplateBodySchema,
  response: {
    mode: 'json',
    schema: updateTemplateResponseSchema,
  },
})

export const deleteTemplateContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/templates/[id]',
  params: templateIdParamsSchema,
  response: {
    mode: 'json',
    schema: deleteTemplateResponseSchema,
  },
})

export const starTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/templates/[id]/star',
  params: templateIdParamsSchema,
  response: {
    mode: 'json',
    schema: templateStarResponseSchema,
  },
})

export const useTemplateBodySchema = z
  .object({
    workspaceId: z.string().optional(),
    connectToTemplate: z.boolean().optional().default(false),
  })
  .passthrough()
export type UseTemplateBody = z.input<typeof useTemplateBodySchema>

export const useTemplateResponseSchema = z.object({
  message: z.string(),
  workflowId: z.string(),
  workspaceId: z.string(),
})

export const useTemplateContract = defineRouteContract({
  method: 'POST',
  path: '/api/templates/[id]/use',
  params: templateIdParamsSchema,
  body: useTemplateBodySchema,
  response: {
    mode: 'json',
    schema: useTemplateResponseSchema,
  },
})

export const updateTemplateOgImageBodySchema = z
  .object({
    imageData: z.string().min(1, 'imageData is required (base64-encoded PNG)'),
  })
  .strict()
export type UpdateTemplateOgImageBody = z.input<typeof updateTemplateOgImageBodySchema>

export const updateTemplateOgImageResponseSchema = z.object({
  success: z.literal(true),
  ogImageUrl: z.string(),
})

export const updateTemplateOgImageContract = defineRouteContract({
  method: 'PUT',
  path: '/api/templates/[id]/og-image',
  params: templateIdParamsSchema,
  body: updateTemplateOgImageBodySchema,
  response: {
    mode: 'json',
    schema: updateTemplateOgImageResponseSchema,
  },
})

export const unstarTemplateContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/templates/[id]/star',
  params: templateIdParamsSchema,
  response: {
    mode: 'json',
    schema: templateStarResponseSchema,
  },
})
