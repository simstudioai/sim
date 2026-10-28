import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const projectFileListAccessParamsSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^/:\s]+$/),
})

const projectFileListAccessResponseSchema = z.object({
  projectId: z.string().min(1),
  canRead: z.literal(true),
})

export const projectFileListAccessContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/project-file-list/[projectId]/access',
  params: projectFileListAccessParamsSchema,
  response: { mode: 'json', schema: projectFileListAccessResponseSchema },
})
