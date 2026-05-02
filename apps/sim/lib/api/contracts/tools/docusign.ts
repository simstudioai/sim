import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const docusignToolBodySchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    operation: z.string().min(1, 'Operation is required'),
  })
  .passthrough()

export const docusignToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/docusign',
  body: docusignToolBodySchema,
  response: {
    mode: 'json',
    // untyped-response: forwards DocuSign API response unchanged; shape varies by operation (envelope, listing, base64 download, etc.)
    schema: z.unknown(),
  },
})
