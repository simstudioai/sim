import { z } from 'zod'
import { unknownRecordSchema } from '@/lib/api/contracts/primitives'

export const stagehandAgentInputSchema = z.object({
  task: z.string().min(1),
  startUrl: z.string().url(),
  outputSchema: z.unknown(),
  variables: z.unknown(),
  provider: z.enum(['openai', 'anthropic']).optional().default('openai'),
  apiKey: z.string(),
  mode: z.enum(['dom', 'hybrid', 'cua']).optional().default('dom'),
  maxSteps: z.number().int().min(1).max(200).optional().default(20),
})

export const stagehandExtractInputSchema = z.object({
  instruction: z.string(),
  schema: unknownRecordSchema,
  provider: z.enum(['openai', 'anthropic']).optional().default('openai'),
  apiKey: z.string(),
  url: z.string().url(),
})

export type StagehandAgentInput = z.output<typeof stagehandAgentInputSchema>
export type StagehandExtractInput = z.output<typeof stagehandExtractInputSchema>
