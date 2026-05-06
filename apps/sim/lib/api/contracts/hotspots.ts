import { z } from 'zod'
import { unknownRecordSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
export const guardrailsValidateContract = defineRouteContract({
  method: 'POST',
  path: '/api/guardrails/validate',
  body: z.object({
    validationType: z.string().optional(),
    input: z.unknown().optional(),
    regex: z.string().optional(),
    knowledgeBaseId: z.string().optional(),
    threshold: z.string().optional(),
    topK: z.string().optional(),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    azureEndpoint: z.string().optional(),
    azureApiVersion: z.string().optional(),
    vertexProject: z.string().optional(),
    vertexLocation: z.string().optional(),
    vertexCredential: z.string().optional(),
    bedrockAccessKeyId: z.string().optional(),
    bedrockSecretKey: z.string().optional(),
    bedrockRegion: z.string().optional(),
    workflowId: z.string().optional(),
    piiEntityTypes: z.array(z.string()).optional(),
    piiMode: z.string().optional(),
    piiLanguage: z.string().optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      output: z.object({
        passed: z.boolean(),
        validationType: z.string(),
        input: z.unknown().optional(),
        error: z.string().optional(),
        score: z.number().optional(),
        reasoning: z.string().optional(),
        detectedEntities: z.array(z.unknown()).optional(),
        maskedText: z.string().optional(),
      }),
    }),
  },
})

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

const wandGenerateBodySchema = z.object({
  prompt: z.string().min(1, 'Missing required field: prompt.'),
  systemPrompt: z.string().optional(),
  stream: z.boolean().optional().default(false),
  history: z.array(chatMessageSchema).optional().default([]),
  workflowId: z.string().optional(),
  generationType: z.string().optional(),
  wandContext: unknownRecordSchema.optional().default({}),
})

export const wandGenerateContract = defineRouteContract({
  method: 'POST',
  path: '/api/wand',
  body: wandGenerateBodySchema,
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})

export const wandGenerateStreamContract = defineRouteContract({
  method: 'POST',
  path: '/api/wand',
  body: wandGenerateBodySchema.extend({
    stream: z.literal(true),
  }),
  response: {
    mode: 'stream',
  },
})

export const functionExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/function/execute',
  body: z.object({
    code: z.string().min(1, 'Code is required'),
    params: unknownRecordSchema.optional().default({}),
    timeout: z.coerce.number().int().positive().optional(),
    language: z.string().optional().default(DEFAULT_CODE_LANGUAGE),
    outputPath: z.string().optional(),
    outputFormat: z.string().optional(),
    outputTable: z.string().optional(),
    outputMimeType: z.string().optional(),
    outputSandboxPath: z.string().optional(),
    envVars: z.record(z.string(), z.string()).optional().default({}),
    blockData: unknownRecordSchema.optional().default({}),
    blockNameMapping: z.record(z.string(), z.string()).optional().default({}),
    blockOutputSchemas: z.record(z.string(), unknownRecordSchema).optional().default({}),
    workflowVariables: unknownRecordSchema.optional().default({}),
    contextVariables: unknownRecordSchema.optional().default({}),
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    userId: z.string().optional(),
    isCustomTool: z.boolean().optional().default(false),
    _sandboxFiles: z
      .array(
        z.object({
          path: z.string(),
          content: z.string(),
          encoding: z.literal('base64').optional(),
        })
      )
      .optional(),
  }),
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})
