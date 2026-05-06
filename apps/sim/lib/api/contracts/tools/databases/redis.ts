import { z } from 'zod'
import { redisExecuteResponseSchema } from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

export const redisExecuteBodySchema = z.object({
  url: z.string().min(1, 'Redis connection URL is required'),
  command: z.string().min(1, 'Redis command is required'),
  args: z.array(z.union([z.string(), z.number()])).default([]),
})

export const redisExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/redis/execute',
  body: redisExecuteBodySchema,
  response: { mode: 'json', schema: redisExecuteResponseSchema },
})

export type RedisExecuteRequest = ContractBodyInput<typeof redisExecuteContract>
export type RedisExecuteResponse = ContractJsonResponse<typeof redisExecuteContract>
