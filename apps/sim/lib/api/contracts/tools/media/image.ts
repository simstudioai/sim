import { z } from 'zod'
export const imageProxyQuerySchema = z.object({
  url: z.string({ error: 'Missing URL parameter' }).min(1, 'Missing URL parameter'),
})
