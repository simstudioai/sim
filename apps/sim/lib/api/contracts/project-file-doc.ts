import { z } from 'zod'
import { persistFileDocResponseSchema } from '@/lib/api/contracts/file-doc'
import { defineRouteContract } from '@/lib/api/contracts/types'

const projectFileDocParamsSchema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
})

const projectFileDocAccessResponseSchema = z.object({
  projectId: z.string(),
  fileId: z.string(),
  canRead: z.literal(true),
  canWrite: z.boolean(),
  docId: z.string().min(1).max(128).nullable(),
})

export const projectFileDocAccessContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-doc/[projectId]/[fileId]/access',
  params: projectFileDocParamsSchema,
  response: { mode: 'json', schema: projectFileDocAccessResponseSchema },
})

const projectFileDocSeedResponseSchema = z.object({
  update: z.string(),
  version: z.number().int(),
})

export const projectFileDocSeedContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-doc/[projectId]/[fileId]/seed',
  params: projectFileDocParamsSchema,
  response: { mode: 'json', schema: projectFileDocSeedResponseSchema },
})

const projectFileDocPersistBodySchema = z
  .object({
    docState: z
      .string()
      .min(1)
      .max(16 * 1024 * 1024),
    expectedVersion: z.number().int().optional(),
  })
  .strict()

export const projectFileDocPersistContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-doc/[projectId]/[fileId]/persist',
  params: projectFileDocParamsSchema,
  body: projectFileDocPersistBodySchema,
  response: { mode: 'json', schema: persistFileDocResponseSchema },
})
