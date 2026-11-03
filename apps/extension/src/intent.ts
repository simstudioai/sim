import { z } from 'zod'

export const captureIntentSchema = z.strictObject({
  tabId: z.number().int(),
  windowId: z.number().int(),
  kind: z.enum(['page', 'selection']),
  createdAt: z.number(),
  documentId: z.string().min(1).max(128),
  urlDigest: z.string().regex(/^[a-f0-9]{64}$/),
})
