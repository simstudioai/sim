import { z } from 'zod'

export const sqsSendInputSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queueUrl: z.string().min(1, 'Queue URL is required'),
  messageGroupId: z.string().nullish(),
  messageDeduplicationId: z.string().nullish(),
  data: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Data object must have at least one field',
  }),
})

export type SqsSendInput = z.output<typeof sqsSendInputSchema>
