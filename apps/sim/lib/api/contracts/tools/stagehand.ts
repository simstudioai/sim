import { z } from 'zod'
import { unknownRecordSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const stagehandProviderSchema = z.enum(['openai', 'anthropic'])

export const stagehandAgentBodySchema = z.object({
  task: z.string().min(1),
  startUrl: z.string().url(),
  outputSchema: z.unknown(),
  variables: z.unknown(),
  provider: stagehandProviderSchema.optional().default('openai'),
  apiKey: z.string(),
  mode: z.enum(['dom', 'hybrid', 'cua']).optional().default('dom'),
  maxSteps: z.number().int().min(1).max(200).optional().default(20),
})

export const stagehandExtractBodySchema = z.object({
  instruction: z.string(),
  schema: unknownRecordSchema,
  provider: stagehandProviderSchema.optional().default('openai'),
  apiKey: z.string(),
  url: z.string().url(),
})

export const stagehandAgentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/stagehand/agent',
  body: stagehandAgentBodySchema,
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})

export const stagehandExtractContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/stagehand/extract',
  body: stagehandExtractBodySchema,
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})
