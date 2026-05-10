import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const imageProxyQuerySchema = z.object({
  url: z.string({ error: 'Missing URL parameter' }).min(1, 'Missing URL parameter'),
})

export const imageProxyContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/image',
  query: imageProxyQuerySchema,
  response: { mode: 'binary' },
})
