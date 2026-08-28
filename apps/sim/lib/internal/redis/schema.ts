import { z } from 'zod'

export const redisExecuteInputSchema = z.object({
  url: z.string().min(1, 'Redis connection URL is required'),
  command: z.string().min(1, 'Redis command is required'),
  args: z.array(z.union([z.string(), z.number()])).default([]),
})

export type RedisExecuteInput = z.output<typeof redisExecuteInputSchema>
