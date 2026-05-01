import { z } from 'zod'
import { internalToolResponseSchema } from '@/lib/api/contracts/tools/internal/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const cursorDownloadArtifactBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  agentId: z.string().min(1, 'Agent ID is required'),
  path: z.string().min(1, 'Artifact path is required'),
})

export const cursorDownloadArtifactContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cursor/download-artifact',
  body: cursorDownloadArtifactBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})
