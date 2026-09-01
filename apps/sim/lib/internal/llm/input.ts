import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

const providerToolSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    params: z.record(z.string(), z.unknown()),
    parameters: z
      .object({
        type: z.string(),
        properties: z.record(z.string(), z.unknown()),
        required: z.array(z.string()),
      })
      .passthrough(),
    usageControl: z.enum(['auto', 'force', 'none']).optional(),
  })
  .passthrough()

const providerMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
    content: z.string().nullable(),
    name: z.string().optional(),
    function_call: z
      .object({
        name: z.string(),
        arguments: z.string(),
      })
      .optional(),
    tool_calls: z
      .array(
        z.object({
          id: z.string(),
          type: z.literal('function'),
          function: z.object({
            name: z.string(),
            arguments: z.string(),
          }),
        })
      )
      .optional(),
    tool_call_id: z.string().optional(),
  })
  .passthrough()

const providerResponseFormatSchema = z
  .object({
    name: z.string(),
    schema: z.unknown(),
    strict: z.boolean().optional(),
  })
  .passthrough()

export const llmProviderOperationInputSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    systemPrompt: z.string().optional(),
    context: z.string().optional(),
    tools: z.array(providerToolSchema).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    apiKey: z.string().optional(),
    azureEndpoint: z.string().optional(),
    azureApiVersion: z.string().optional(),
    vertexProject: z.string().optional(),
    vertexLocation: z.string().optional(),
    vertexCredential: z.string().optional(),
    bedrockAccessKeyId: z.string().optional(),
    bedrockSecretKey: z.string().optional(),
    bedrockRegion: z.string().optional(),
    responseFormat: providerResponseFormatSchema.optional(),
    workflowId: z.string().optional(),
    workspaceId: z.string().optional(),
    stream: z.boolean().optional(),
    messages: z.array(providerMessageSchema).optional(),
    environmentVariables: z.record(z.string(), z.string()).optional(),
    workflowVariables: z.record(z.string(), z.unknown()).optional(),
    blockData: z.record(z.string(), z.unknown()).optional(),
    blockNameMapping: z.record(z.string(), z.string()).optional(),
    reasoningEffort: z.string().optional(),
    verbosity: z.string().optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
  .passthrough()

export type LlmProviderOperationInput = z.input<typeof llmProviderOperationInputSchema>
