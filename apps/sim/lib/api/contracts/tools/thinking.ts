import { z } from 'zod'
import {
  toolFailureResponseSchema,
  toolSuccessResponseSchema,
} from '@/lib/api/contracts/tool-primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const thinkingToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/thinking',
  body: z.object({
    thought: z.string().min(1, 'The thought parameter is required and must be a string'),
  }),
  response: {
    mode: 'json',
    schema: z.union([
      toolSuccessResponseSchema(
        z.object({
          acknowledgedThought: z.string(),
        })
      ),
      toolFailureResponseSchema,
    ]),
  },
})
