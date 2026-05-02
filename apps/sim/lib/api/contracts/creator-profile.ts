import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const creatorProfileDetailsSchema = z.object({
  about: z.string().max(2000, 'Max 2000 characters').optional(),
  xUrl: z.string().url().optional().or(z.literal('')),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
})

export const creatorProfileParamsSchema = z.object({
  id: z.string().min(1),
})

export const listCreatorProfilesQuerySchema = z.object({
  userId: z.string().optional(),
})

export const createCreatorProfileBodySchema = z.object({
  referenceType: z.enum(['user', 'organization']),
  referenceId: z.string().min(1, 'Reference ID is required'),
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters'),
  profileImageUrl: z.string().min(1, 'Profile image is required'),
  details: creatorProfileDetailsSchema.optional(),
})

export const updateCreatorProfileBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters').optional(),
  profileImageUrl: z.string().optional().or(z.literal('')),
  details: creatorProfileDetailsSchema.optional(),
  verified: z.boolean().optional(),
})

export const creatorProfileSchema = z.object({
  id: z.string(),
  referenceType: z.enum(['user', 'organization']),
  referenceId: z.string(),
  name: z.string(),
  profileImageUrl: z.string().nullable(),
  details: creatorProfileDetailsSchema.nullable(),
  verified: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const creatorOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
})

export type CreatorProfileDetails = z.output<typeof creatorProfileDetailsSchema>
export type CreatorProfileContract = z.output<typeof creatorProfileSchema>
export type CreatorOrganization = z.output<typeof creatorOrganizationSchema>

export const listCreatorOrganizationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations',
  response: {
    mode: 'json',
    schema: z.object({
      organizations: z.array(creatorOrganizationSchema),
      isMemberOfAnyOrg: z.boolean(),
    }),
  },
})

export const listCreatorProfilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/creators',
  query: listCreatorProfilesQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      profiles: z.array(creatorProfileSchema),
    }),
  },
})

export const createCreatorProfileContract = defineRouteContract({
  method: 'POST',
  path: '/api/creators',
  body: createCreatorProfileBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: creatorProfileSchema,
    }),
  },
})

export const getCreatorProfileContract = defineRouteContract({
  method: 'GET',
  path: '/api/creators/[id]',
  params: creatorProfileParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: creatorProfileSchema,
    }),
  },
})

export const updateCreatorProfileContract = defineRouteContract({
  method: 'PUT',
  path: '/api/creators/[id]',
  params: creatorProfileParamsSchema,
  body: updateCreatorProfileBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: creatorProfileSchema,
    }),
  },
})

export const deleteCreatorProfileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/creators/[id]',
  params: creatorProfileParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
    }),
  },
})
