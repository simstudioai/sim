import type { PerplexityAgentParams, PerplexityAgentResponse } from '@/tools/perplexity/types'
import type { ToolConfig } from '@/tools/types'

interface AgentOutputText {
  type: string
  text: string
}

interface AgentSearchResult {
  title: string
  url: string
  snippet: string
  date?: string | null
  last_updated?: string | null
}

interface AgentOutputItem {
  type: string
  content?: AgentOutputText[]
  results?: AgentSearchResult[]
}

/** Fields the Agent API response schema marks required are typed as required. */
interface AgentResponseData {
  model: string
  status: string
  output?: AgentOutputItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cost?: { total_cost?: number }
  }
}

const AGENT_RUN_FAILED_MESSAGE =
  'Perplexity agent run failed. Check the model id, the enabled tools and max_steps, then retry.'

export const agentTool: ToolConfig<PerplexityAgentParams, PerplexityAgentResponse> = {
  id: 'perplexity_agent',
  name: 'Perplexity Agent',
  description:
    'Run a Perplexity or third-party model through the Perplexity Agent API with built-in web search and URL fetch, returning the answer, its sources and usage',
  version: '1.0.0',

  params: {
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question or task for the agent',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Agent API model (e.g., "anthropic/claude-opus-5-5", "openai/gpt-5.5")',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instructions that guide the agent behavior',
    },
    web_search: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Let the agent search the web (default: true)',
    },
    fetch_url: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Let the agent fetch the full content of URLs (default: false)',
    },
    max_steps: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of agent steps, including tool calls (e.g., 3)',
    },
    max_tokens: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of output tokens to generate (e.g., 1024, 4096)',
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
      getCost: (_params, output) => {
        const cost = (output.__cost as { total_cost?: number } | undefined)?.total_cost
        if (cost == null) {
          throw new Error('Perplexity agent response missing usage.cost.total_cost')
        }
        return { cost, metadata: { model: output.model, usage: output.usage } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 20,
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        content: params.content,
        systemPrompt: params.systemPrompt,
      }),
    },
    method: 'POST',
    url: () => 'https://api.perplexity.ai/v1/agent',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-Pplx-Integration': 'sim',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        model: params.model,
        input: params.content,
      }

      const tools: Array<{ type: string }> = []
      if (params.web_search !== false) tools.push({ type: 'web_search' })
      if (params.fetch_url) tools.push({ type: 'fetch_url' })
      if (tools.length > 0) body.tools = tools

      if (params.systemPrompt) body.instructions = params.systemPrompt
      if (params.max_steps !== undefined) body.max_steps = Number(params.max_steps)
      if (params.max_tokens !== undefined) body.max_output_tokens = Number(params.max_tokens)

      return body
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as AgentResponseData
    const items = data.output ?? []

    const output = {
      content: items
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text')
        .map((part) => part.text)
        .join('\n\n'),
      model: data.model,
      status: data.status,
      sources: items
        .filter((item) => item.type === 'search_results')
        .flatMap((item) => item.results ?? [])
        .map((result) => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          date: result.date ?? null,
          last_updated: result.last_updated ?? null,
        })),
      usage: {
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
      __cost: data.usage?.cost,
    }

    if (data.status === 'failed') {
      return {
        success: false,
        output,
        error: AGENT_RUN_FAILED_MESSAGE,
      }
    }

    return { success: true, output }
  },

  outputs: {
    content: { type: 'string', description: 'The answer produced by the agent' },
    model: { type: 'string', description: 'Model used for the run' },
    status: {
      type: 'string',
      description: 'Final status of the run (completed, or incomplete when a limit was reached)',
    },
    sources: {
      type: 'array',
      description: 'Web search results the agent used',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the source' },
          url: { type: 'string', description: 'URL of the source' },
          snippet: { type: 'string', description: 'Excerpt of the source content' },
          date: { type: 'string', description: 'Publication date of the source', nullable: true },
          last_updated: {
            type: 'string',
            description: "Date the page was last updated in Perplexity's index",
            nullable: true,
          },
        },
      },
    },
    usage: {
      type: 'object',
      description: 'Token usage information',
      properties: {
        input_tokens: { type: 'number', description: 'Number of input tokens' },
        output_tokens: { type: 'number', description: 'Number of output tokens' },
        total_tokens: { type: 'number', description: 'Total number of tokens used' },
      },
    },
  },
}
