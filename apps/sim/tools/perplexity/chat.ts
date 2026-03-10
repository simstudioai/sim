import type { PerplexityChatParams, PerplexityChatResponse } from '@/tools/perplexity/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Per-token rates by model from https://docs.perplexity.ai/guides/pricing
 * Per-request fees assume Low context size (the API default).
 * Deep Research has additional billing dimensions: citation tokens, search queries, reasoning tokens.
 */
const MODEL_PRICING: Record<
  string,
  {
    inputPerM: number
    outputPerM: number
    requestPer1K: number
    citationPerM?: number
    searchQueriesPer1K?: number
    reasoningPerM?: number
  }
> = {
  'sonar-deep-research': {
    inputPerM: 2,
    outputPerM: 8,
    requestPer1K: 0,
    citationPerM: 2,
    searchQueriesPer1K: 5,
    reasoningPerM: 3,
  },
  'sonar-reasoning-pro': { inputPerM: 2, outputPerM: 8, requestPer1K: 6 },
  'sonar-pro': { inputPerM: 3, outputPerM: 15, requestPer1K: 6 },
  sonar: { inputPerM: 1, outputPerM: 1, requestPer1K: 5 },
}

function getModelPricing(model: string) {
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key)) return pricing
  }
  return MODEL_PRICING.sonar
}

export const chatTool: ToolConfig<PerplexityChatParams, PerplexityChatResponse> = {
  id: 'perplexity_chat',
  name: 'Perplexity Chat',
  description: 'Generate completions using Perplexity AI chat models',
  version: '1.0',

  params: {
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'System prompt to guide the model behavior',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user message content to send to the model',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Model to use for chat completions (e.g., "sonar", "sonar-pro", "sonar-reasoning")',
    },
    max_tokens: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tokens to generate (e.g., 1024, 2048, 4096)',
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sampling temperature between 0 and 1 (e.g., 0.0 for deterministic, 0.7 for creative)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Perplexity API key',
    },
  },

  hosting: {
    envKeyPrefix: 'PERPLEXITY_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'perplexity',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const usage = output.usage as
          | {
              prompt_tokens?: number
              completion_tokens?: number
              citation_tokens?: number
              num_search_queries?: number
              reasoning_tokens?: number
            }
          | undefined
        if (!usage || usage.prompt_tokens == null || usage.completion_tokens == null) {
          throw new Error('Perplexity chat response missing token usage data')
        }

        const model = ((output.model as string) || params.model) as string
        const pricing = getModelPricing(model)
        const inputTokens = usage.prompt_tokens
        const outputTokens = usage.completion_tokens

        const tokenCost =
          (inputTokens * pricing.inputPerM) / 1_000_000 +
          (outputTokens * pricing.outputPerM) / 1_000_000
        const requestFee = pricing.requestPer1K / 1000

        let citationCost = 0
        let searchQueryCost = 0
        let reasoningCost = 0

        if (pricing.citationPerM && usage.citation_tokens) {
          citationCost = (usage.citation_tokens * pricing.citationPerM) / 1_000_000
        }
        if (pricing.searchQueriesPer1K && usage.num_search_queries) {
          searchQueryCost = (usage.num_search_queries * pricing.searchQueriesPer1K) / 1000
        }
        if (pricing.reasoningPerM && usage.reasoning_tokens) {
          reasoningCost = (usage.reasoning_tokens * pricing.reasoningPerM) / 1_000_000
        }

        const cost = tokenCost + requestFee + citationCost + searchQueryCost + reasoningCost

        return {
          cost,
          metadata: {
            model,
            inputTokens,
            outputTokens,
            tokenCost,
            requestFee,
            citationTokens: usage.citation_tokens,
            citationCost,
            searchQueries: usage.num_search_queries,
            searchQueryCost,
            reasoningTokens: usage.reasoning_tokens,
            reasoningCost,
          },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 20,
    },
    skipFixedUsageLog: true,
  },

  request: {
    method: 'POST',
    url: () => 'https://api.perplexity.ai/chat/completions',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const messages: Array<{ role: string; content: string }> = []

      // Add system prompt if provided
      if (params.systemPrompt) {
        messages.push({
          role: 'system',
          content: params.systemPrompt,
        })
      }

      // Add user message
      messages.push({
        role: 'user',
        content: params.content,
      })

      const body: Record<string, any> = {
        model: params.model,
        messages: messages,
      }

      // Add optional parameters if provided
      if (params.max_tokens !== undefined) {
        body.max_tokens = Number(params.max_tokens) || 10000
      }

      if (params.temperature !== undefined) {
        body.temperature = Number(params.temperature)
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        content: data.choices[0].message.content,
        model: data.model,
        usage: {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          ...(data.usage.citation_tokens != null && {
            citation_tokens: data.usage.citation_tokens,
          }),
          ...(data.usage.num_search_queries != null && {
            num_search_queries: data.usage.num_search_queries,
          }),
          ...(data.usage.reasoning_tokens != null && {
            reasoning_tokens: data.usage.reasoning_tokens,
          }),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Generated text content' },
    model: { type: 'string', description: 'Model used for generation' },
    usage: {
      type: 'object',
      description: 'Token usage information',
      properties: {
        prompt_tokens: { type: 'number', description: 'Number of tokens in the prompt' },
        completion_tokens: {
          type: 'number',
          description: 'Number of tokens in the completion',
        },
        total_tokens: { type: 'number', description: 'Total number of tokens used' },
      },
    },
  },
}
