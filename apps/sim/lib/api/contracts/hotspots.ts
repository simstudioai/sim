import { z } from 'zod'
import {
  customPatternSchema,
  privateSecretProvenanceBundleSchema,
  stringRecordSchema,
  unknownRecordSchema,
  userFileSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { MAX_BLOCK_MOUNTED_FILES } from '@/lib/execution/remote-sandbox/sandbox-paths'
import {
  MAX_PII_VALIDATION_DETECTED_ENTITIES,
  MAX_PII_VALIDATION_TEXT_CHARACTERS,
} from '@/lib/guardrails/pii-limits'

const guardrailsMaskBatchBodySchema = z.object({
  texts: z.array(z.string()).max(100_000),
  entityTypes: z.array(z.string().min(1, 'Entity type cannot be empty')).max(200),
  language: z.string().min(1).max(20).optional(),
  customPatterns: z.array(customPatternSchema).max(20).optional(),
})

const guardrailsMaskBatchResponseSchema = z.object({
  masked: z.array(z.string()),
})

export const guardrailsPiiValidateBodySchema = z
  .object({
    text: z.string().max(MAX_PII_VALIDATION_TEXT_CHARACTERS, 'Text is too long'),
    entityTypes: z.array(z.string().min(1, 'Entity type cannot be empty')).max(200),
    mode: z.enum(['block', 'mask']),
    language: z.string().min(1, 'Language cannot be empty').max(20).optional(),
    customPatterns: z.array(customPatternSchema).max(20).optional(),
  })
  .strict()

export const detectedPiiEntitySchema = z
  .object({
    type: z.string().min(1, 'Entity type cannot be empty').max(100),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
    text: z.string().max(MAX_PII_VALIDATION_TEXT_CHARACTERS, 'Detected text is too long'),
  })
  .strict()

export const guardrailsPiiValidateResponseSchema = z
  .object({
    passed: z.boolean(),
    error: z.string().max(1_000).optional(),
    detectedEntities: z.array(detectedPiiEntitySchema).max(MAX_PII_VALIDATION_DETECTED_ENTITIES),
    maskedText: z
      .string()
      .max(MAX_PII_VALIDATION_TEXT_CHARACTERS, 'Masked text is too long')
      .optional(),
  })
  .strict()

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

/**
 * Internal single-text PII validation. The workflow executor can run outside
 * the app network, while only the app task can reach the Presidio service.
 */
export const guardrailsPiiValidateContract = defineRouteContract({
  method: 'POST',
  path: '/api/guardrails/pii/validate',
  body: guardrailsPiiValidateBodySchema,
  response: {
    mode: 'json',
    schema: guardrailsPiiValidateResponseSchema,
  },
})

export type GuardrailsPiiValidateBody = z.input<typeof guardrailsPiiValidateBodySchema>
export type GuardrailsPiiValidateResult = z.output<typeof guardrailsPiiValidateResponseSchema>

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

export const functionExecuteBodySchema = z
  .object({
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
    /**
     * Platform file objects mounted into the sandbox before the code runs.
     * Distinct from `inputs.files`, which names workspace VFS paths: these are
     * the same objects tools exchange, so an upstream block's output can be
     * mounted without first being written to the workspace.
     */
    files: z
      .array(userFileSchema)
      .max(
        MAX_BLOCK_MOUNTED_FILES,
        `At most ${MAX_BLOCK_MOUNTED_FILES} files can be mounted into the sandbox`
      )
      .optional(),
    outputs: z
      .object({
        files: z.array(functionOutputFileSchema).optional(),
      })
      .strict()
      .optional(),
    envVars: stringRecordSchema.optional().default({}),
    blockData: unknownRecordSchema.optional().default({}),
    blockNameMapping: stringRecordSchema.optional().default({}),
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
    /** Workspace sandbox whose dependency set this execution runs against. */
    sandboxId: z.string().optional(),
    /**
     * Reusable session-sandbox identity (one per Mothership chat). Honored only
     * for trusted Mothership executions; workspace callers cannot opt in.
     */
    sandboxSessionKey: z.string().optional(),
    /** `all` (default) or `selected`; see mountedSecrets. */
    secretScope: z.enum(['all', 'selected']).optional(),
    /** Secret names this execution may read when secretScope is `selected`. */
    mountedSecrets: z.array(z.string()).optional(),
    /**
     * Secret names the caller's registry certifies as redaction-exempt (collision-free).
     * Exported files containing only these values are not provenance-locked. Trusted the
     * same way envVars is: the internal caller already holds the plaintexts.
     */
    unredactedSecretNames: z.array(z.string()).optional(),
    [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
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
  })
  .superRefine((body, context) => {
    if (body.outputSandboxPath && !body.outputPath?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outputPath'],
        message:
          'outputSandboxPath requires outputPath. Set outputPath to the destination workspace file, e.g. "files/result.csv".',
      })
    }
  })

export type FunctionExecuteBody = z.input<typeof functionExecuteBodySchema>
export type ParsedFunctionExecuteBody = z.output<typeof functionExecuteBodySchema>
