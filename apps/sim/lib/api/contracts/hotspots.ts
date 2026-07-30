import { z } from 'zod'
import { customPatternSchema, unknownRecordSchema } from '@/lib/api/contracts/primitives'
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
    piiCustomPatterns: z.array(customPatternSchema).max(20).optional(),
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

const guardrailsMaskBatchBodySchema = z.object({
  texts: z.array(z.string()).max(100_000),
  entityTypes: z.array(z.string().min(1, 'Entity type cannot be empty')).max(200),
  language: z.string().min(1).max(20).optional(),
  customPatterns: z.array(customPatternSchema).max(20).optional(),
})

const guardrailsMaskBatchResponseSchema = z.object({
  masked: z.array(z.string()),
})

/**
 * Internal batch PII masking. Called server-to-server (internal JWT) from the
 * log-redaction persist path so Presidio always runs in the app container,
 * including for async executions that persist inside the trigger.dev runtime.
 */
export const guardrailsMaskBatchContract = defineRouteContract({
  method: 'POST',
  path: '/api/guardrails/mask-batch',
  body: guardrailsMaskBatchBodySchema,
  response: {
    mode: 'json',
    schema: guardrailsMaskBatchResponseSchema,
  },
})

export type GuardrailsMaskBatchBody = z.input<typeof guardrailsMaskBatchBodySchema>
export type GuardrailsMaskBatchResult = z.output<typeof guardrailsMaskBatchResponseSchema>

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
  /** Falls back here for per-member usage attribution when no workflowId is sent. */
  workspaceId: z.string().optional(),
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

const functionFileInputSchema = z
  .object({
    path: z.string().min(1, 'Input file path is required'),
    sandboxPath: z.string().optional(),
  })
  .strict()

const functionDirectoryInputSchema = z
  .object({
    path: z.string().min(1, 'Input directory path is required'),
    sandboxPath: z.string().optional(),
  })
  .strict()

const functionTableInputSchema = z
  .object({
    path: z.string().optional(),
    tableId: z.string().optional(),
    sandboxPath: z.string().optional(),
  })
  .strict()

const functionOutputFileSchema = z
  .object({
    path: z.string().min(1, 'Output file path is required'),
    mode: z.enum(['create', 'overwrite']).default('create'),
    sandboxPath: z.string().optional(),
    format: z.enum(['json', 'csv', 'txt', 'md', 'html']).optional(),
    mimeType: z.string().optional(),
  })
  .strict()

export const functionExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/function/execute',
  body: z.object({
    code: z.string().min(1, 'Code is required'),
    sourceCode: z.string().optional(),
    params: unknownRecordSchema.optional().default({}),
    timeout: z.coerce.number().int().positive().optional(),
    language: z.string().optional().default(DEFAULT_CODE_LANGUAGE),
    title: z.string().optional(),
    outputPath: z.string().optional(),
    outputFormat: z.string().optional(),
    outputTable: z.string().optional(),
    outputMimeType: z.string().optional(),
    outputSandboxPath: z.string().optional(),
    overwriteFileId: z.string().optional(),
    inputs: z
      .object({
        files: z.array(functionFileInputSchema).optional(),
        directories: z.array(functionDirectoryInputSchema).optional(),
        tables: z.array(functionTableInputSchema).optional(),
      })
      .strict()
      .optional(),
    outputs: z
      .object({
        files: z.array(functionOutputFileSchema).optional(),
      })
      .strict()
      .optional(),
    envVars: z.record(z.string(), z.string()).optional().default({}),
    blockData: unknownRecordSchema.optional().default({}),
    blockNameMapping: z.record(z.string(), z.string()).optional().default({}),
    blockOutputSchemas: z.record(z.string(), unknownRecordSchema).optional().default({}),
    workflowVariables: unknownRecordSchema.optional().default({}),
    contextVariables: unknownRecordSchema.optional().default({}),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
    largeValueExecutionIds: z.array(z.string()).optional(),
    largeValueKeys: z.array(z.string()).optional(),
    fileKeys: z.array(z.string()).optional(),
    allowLargeValueWorkflowScope: z.boolean().optional(),
    workspaceId: z.string().optional(),
    userId: z.string().optional(),
    isCustomTool: z.boolean().optional().default(false),
    _sandboxFiles: z
      .array(
        z.union([
          z.object({
            type: z.literal('content').optional(),
            path: z.string(),
            content: z.string(),
            encoding: z.literal('base64').optional(),
          }),
          // Mounted by reference: the sandbox fetches `url` itself (no bytes through the web tier).
          z.object({
            type: z.literal('url'),
            path: z.string(),
            url: z.string(),
          }),
        ])
      )
      .optional(),
  }),
  response: {
    mode: 'json',
    schema: unknownRecordSchema,
  },
})
