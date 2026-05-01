import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const academyCertificateMetadataSchema = z.object({
  recipientName: z.string(),
  courseTitle: z.string(),
})

export const academyCertificateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  courseId: z.string(),
  status: z.enum(['active', 'revoked', 'expired']),
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  certificateNumber: z.string(),
  metadata: academyCertificateMetadataSchema.nullable(),
  createdAt: z.coerce.date(),
})

export const getAcademyCertificateQuerySchema = z.object({
  courseId: z.string().min(1),
})

export const issueAcademyCertificateBodySchema = z.object({
  courseId: z.string().min(1),
  completedLessonIds: z.array(z.string()),
})

export const getAcademyCertificateContract = defineRouteContract({
  method: 'GET',
  path: '/api/academy/certificates',
  query: getAcademyCertificateQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      certificate: academyCertificateSchema.nullable(),
    }),
  },
})

export const issueAcademyCertificateContract = defineRouteContract({
  method: 'POST',
  path: '/api/academy/certificates',
  body: issueAcademyCertificateBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      certificate: academyCertificateSchema,
    }),
  },
})
