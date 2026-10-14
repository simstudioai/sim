import { z } from 'zod'
import { persistFileDocResponseSchema } from '@/lib/api/contracts/file-doc'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const projectFileDocParamsSchema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
})
export type ProjectFileDocParams = z.output<typeof projectFileDocParamsSchema>

export const projectFileDocAccessResponseSchema = z.object({
  projectId: z.string(),
  fileId: z.string(),
  canRead: z.literal(true),
  canWrite: z.boolean(),
  docId: z.string().min(1).max(128).nullable(),
})
export type ProjectFileDocAccessResponse = z.output<typeof projectFileDocAccessResponseSchema>

export const projectFileDocAccessContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-doc/[projectId]/[fileId]/access',
  params: projectFileDocParamsSchema,
  response: { mode: 'json', schema: projectFileDocAccessResponseSchema },
})

export const projectFileDocSeedResponseSchema = z.object({
  update: z.string(),
  version: z.number().int(),
})
export type ProjectFileDocSeedResponse = z.output<typeof projectFileDocSeedResponseSchema>

export const projectFileDocSeedContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-doc/[projectId]/[fileId]/seed',
  params: projectFileDocParamsSchema,
  response: { mode: 'json', schema: projectFileDocSeedResponseSchema },
})

export const projectFileDocPersistBodySchema = z
  .object({
    docState: z
      .string()
      .min(1)
      .max(16 * 1024 * 1024),
    expectedVersion: z.number().int().optional(),
  })
  .strict()
export type ProjectFileDocPersistBody = z.input<typeof projectFileDocPersistBodySchema>

export const projectFileDocPersistContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-doc/[projectId]/[fileId]/persist',
  params: projectFileDocParamsSchema,
  body: projectFileDocPersistBodySchema,
  response: { mode: 'json', schema: persistFileDocResponseSchema },
})
