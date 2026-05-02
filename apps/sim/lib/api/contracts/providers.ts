import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const openRouterModelInfoSchema = z.object({
  id: z.string(),
  contextLength: z.number().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  pricing: z
    .object({
      input: z.number(),
      output: z.number(),
    })
    .optional(),
})

export const providerModelsResponseSchema = z.object({
  models: z.array(z.string()),
  modelInfo: z.record(z.string(), openRouterModelInfoSchema).optional(),
})
export type ProviderModelsResponse = z.output<typeof providerModelsResponseSchema>

export const fireworksProviderModelsQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

export const openRouterUpstreamResponseSchema = z.object({
  data: z
    .array(
      z
        .object({
          id: z.string(),
          context_length: z.number().optional(),
          supported_parameters: z.array(z.string()).optional(),
          pricing: z
            .object({
              prompt: z.string().optional(),
              completion: z.string().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
    )
    .default([]),
})

export const vllmUpstreamResponseSchema = z.object({
  data: z
    .array(
      z
        .object({
          id: z.string(),
        })
        .passthrough()
    )
    .default([]),
})

export const fireworksUpstreamResponseSchema = z.object({
  data: z
    .array(
      z
        .object({
          id: z.string(),
          object: z.string().optional(),
          created: z.number().optional(),
          owned_by: z.string().optional(),
        })
        .passthrough()
    )
    .default([]),
  object: z.string().optional(),
})

export const ollamaUpstreamResponseSchema = z.object({
  models: z
    .array(
      z
        .object({
          name: z.string(),
        })
        .passthrough()
    )
    .default([]),
})

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
    // untyped-response: caller-supplied JSON Schema (request body field, not a route response)
    schema: z.unknown(),
    strict: z.boolean().optional(),
  })
  .passthrough()

export const providerApiRequestBodySchema = z
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
  })
  .passthrough()
export type ProviderApiRequestBody = z.input<typeof providerApiRequestBodySchema>

export const getBaseProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/base/models',
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getOllamaProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/ollama/models',
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getVllmProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/vllm/models',
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getOpenRouterProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/openrouter/models',
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getFireworksProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/fireworks/models',
  query: fireworksProviderModelsQuerySchema,
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

/**
 * `POST /api/providers` returns either a streamed response (handled at the
 * runtime level — this contract models only the JSON case) or a JSON provider
 * payload. The JSON case mirrors the canonical `ProviderResponse` shape from
 * `@/providers/types`, but provider-specific fields are tolerated via
 * passthrough so raw provider output flows through without contract drift.
 */
const executeProviderResponseSchema = z
  .object({
    content: z.string(),
    model: z.string(),
    tokens: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        total: z.number().optional(),
      })
      .optional(),
    toolCalls: z.array(z.record(z.string(), z.unknown())).optional(),
    toolResults: z.array(z.record(z.string(), z.unknown())).optional(),
    timing: z.record(z.string(), z.unknown()).optional(),
    cost: z.record(z.string(), z.unknown()).optional(),
    interactionId: z.string().optional(),
  })
  .passthrough()

export const executeProviderContract = defineRouteContract({
  method: 'POST',
  path: '/api/providers',
  body: providerApiRequestBodySchema,
  response: {
    mode: 'json',
    schema: executeProviderResponseSchema,
  },
})
