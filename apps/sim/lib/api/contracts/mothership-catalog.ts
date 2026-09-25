import { z } from 'zod'
import { v2BlockDetailSchema, v2BlockFieldSchema } from '@/lib/api/contracts/v2/catalog'

/** Internal discovery adds compact catalog hints without changing the public v2 response. */
const mothershipBlockFieldSchema = v2BlockFieldSchema.extend({
  valueSchema: z.record(z.string(), z.unknown()).optional(),
  toolBinding: z
    .object({
      selectionMode: z.enum(['explicit', 'additive']),
      discovery: z.array(z.string()),
      naming: z.string(),
      access: z.string(),
    })
    .optional(),
  optionsAvailability: z.string().optional(),
  options: z
    .array(
      v2BlockFieldSchema.shape.options.unwrap().element.extend({
        recommended: z.literal(true).optional(),
        speedOptimized: z.literal(true).optional(),
        sunset: z.object({ status: z.enum(['legacy', 'deprecated']) }).optional(),
      })
    )
    .optional(),
})

export const mothershipBlockDetailSchema = v2BlockDetailSchema.extend({
  inputSchema: z.array(mothershipBlockFieldSchema),
  operationAvailability: z
    .record(z.string(), z.object({ enabled: z.boolean(), reason: z.string().optional() }))
    .optional(),
})
export type MothershipBlockDetail = z.infer<typeof mothershipBlockDetailSchema>
