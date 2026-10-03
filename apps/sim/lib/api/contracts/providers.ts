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

export const ollamaCloudProviderModelsQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

export const togetherProviderModelsQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

export const basetenProviderModelsQuerySchema = z.object({
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

export const openRouterEmbeddingModelsUpstreamResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string().min(1, 'OpenRouter embedding model id cannot be empty'),
        context_length: z
          .number()
          .int('OpenRouter embedding context length must be an integer')
          .positive('OpenRouter embedding context length must be positive'),
      })
      .passthrough()
  ),
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

const togetherModelObjectSchema = z
  .object({
    id: z.string(),
    object: z.string().optional(),
    created: z.number().optional(),
    type: z.string().optional(),
    display_name: z.string().optional(),
    organization: z.string().optional(),
    context_length: z.number().optional(),
  })
  .passthrough()

/** Together's `GET /v1/models` returns a bare top-level array of model objects. */
export const togetherUpstreamResponseSchema = z.array(togetherModelObjectSchema)

export const basetenUpstreamResponseSchema = z.object({
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

// Shared by the local Ollama and Ollama Cloud /api/tags endpoints — same `{ models: [{ name }] }` shape.
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

/**
 * Ollama `/api/show`. `capabilities` is what separates an embedding model from a
 * chat one — `/api/tags` lists both and says nothing about either. `model_info`
 * is keyed by architecture (`nomic-bert.embedding_length`, `bert.embedding_length`,
 * …), so the width is found by suffix rather than by a fixed key.
 *
 * Both fields are optional: an Ollama older than 0.5 reports no `capabilities`,
 * and a model whose architecture publishes no embedding length simply has none
 * to show.
 */
export const ollamaShowUpstreamResponseSchema = z
  .object({
    capabilities: z.array(z.string()).optional(),
    model_info: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

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

export const getOpenRouterEmbeddingModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/openrouter/embeddings/models',
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getLitellmProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/litellm/models',
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

export const getOllamaCloudProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/ollama-cloud/models',
  query: ollamaCloudProviderModelsQuerySchema,
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getTogetherProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/together/models',
  query: togetherProviderModelsQuerySchema,
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})

export const getBasetenProviderModelsContract = defineRouteContract({
  method: 'GET',
  path: '/api/providers/baseten/models',
  query: basetenProviderModelsQuerySchema,
  response: {
    mode: 'json',
    schema: providerModelsResponseSchema,
  },
})
