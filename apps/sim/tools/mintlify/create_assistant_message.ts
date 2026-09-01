import { generateId } from '@sim/utils/id'
import type {
  MintlifyAssistantSource,
  MintlifyCreateAssistantMessageParams,
  MintlifyCreateAssistantMessageResponse,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  toNullableString,
  toObjectArray,
  toStringArray,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

interface AssistantStreamResult {
  text: string
  threadId: string | null
  sources: MintlifyAssistantSource[]
  errorText: string | null
}

/**
 * Collapses the AI SDK v5 UI message stream the assistant endpoint returns into
 * the assembled answer text, its cited sources, and the thread ID emitted on
 * the terminal `finish` event.
 */
function parseAssistantStream(body: string): AssistantStreamResult {
  const result: AssistantStreamResult = { text: '', threadId: null, sources: [], errorText: null }

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue

    const payload = line.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue

    let event: Record<string, unknown>
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }

    switch (event.type) {
      case 'text-delta':
        if (typeof event.delta === 'string') result.text += event.delta
        break
      case 'source-url':
        result.sources.push({
          sourceId: toNullableString(event.sourceId),
          url: toNullableString(event.url),
          title: toNullableString(event.title),
        })
        break
      case 'error':
        result.errorText = toNullableString(event.errorText)
        break
      case 'finish':
        result.threadId = toNullableString(event.threadId)
        break
      default:
        break
    }
  }

  return result
}

export const mintlifyCreateAssistantMessageTool: ToolConfig<
  MintlifyCreateAssistantMessageParams,
  MintlifyCreateAssistantMessageResponse
> = {
  id: 'mintlify_create_assistant_message',
  name: 'Mintlify Create Assistant Message',
  description:
    "Ask the Mintlify assistant, trained on your documentation, a question and get the assembled answer with its cited sources. Consumes the deployment's assistant credits.",
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Domain identifier from your domain.mintlify.site URL, found at the end of your dashboard URL',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The question to ask the assistant. Ignored when a full Messages array is supplied.',
    },
    messages: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Full AI SDK message array for multi-turn conversations, each entry with id, role, and parts. Overrides Message when provided.',
    },
    fp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fingerprint identifier for tracking conversation sessions (default "anonymous")',
    },
    threadId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread ID from a previous response, to continue the same conversation',
    },
    retrievalPageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of documentation search results used to generate the response',
    },
    currentPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Path of the page the user is currently viewing, for more relevant answers (max 200 characters)',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter retrieval by documentation version',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter retrieval by content language',
    },
    groups: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group identifiers to filter retrieval by, as a JSON array of strings',
    },
    assistantContext: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Contextual snippets for the assistant, as a JSON array of objects with type ("code" or "textSelection"), value, and optional path and elementId',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify assistant API key (starts with mint_dsc_)',
    },
  },

  request: {
    url: (params) =>
      `${MINTLIFY_API_BASE}/discovery/v2/assistant/${pathSegment(params.domain)}/message`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => {
      const messages = toObjectArray(params.messages)
      if (!messages && !params.message) {
        throw new Error('Either Message or Messages is required')
      }

      const body: Record<string, unknown> = {
        fp: params.fp || 'anonymous',
        messages: messages ?? [
          {
            id: generateId(),
            role: 'user',
            parts: [{ type: 'text', text: params.message }],
          },
        ],
      }

      if (params.threadId) body.threadId = params.threadId
      if (params.retrievalPageSize !== undefined) {
        body.retrievalPageSize = params.retrievalPageSize
      }
      if (params.currentPath) body.currentPath = params.currentPath

      const groups = toStringArray(params.groups)
      const filter: Record<string, unknown> = {}
      if (params.version) filter.version = params.version
      if (params.language) filter.language = params.language
      if (groups) filter.groups = groups
      if (Object.keys(filter).length > 0) body.filter = filter

      const context = toObjectArray(params.assistantContext)
      if (context) body.context = context

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const body = await response.text()

    if (!response.ok) {
      let message = body.trim()
      try {
        const parsed = JSON.parse(body)
        message = parsed?.error || parsed?.message || message
      } catch {
        // Non-JSON error bodies are surfaced verbatim.
      }
      throw new Error(
        message || `Failed to create Mintlify assistant message (HTTP ${response.status})`
      )
    }

    const stream = parseAssistantStream(body)
    if (stream.errorText) {
      throw new Error(stream.errorText)
    }

    return {
      success: true,
      output: {
        text: stream.text,
        threadId: stream.threadId,
        sources: stream.sources,
      },
    }
  },

  outputs: {
    text: { type: 'string', description: 'Assembled assistant answer' },
    threadId: {
      type: 'string',
      description: 'Thread ID for continuing this conversation in a follow-up call',
      nullable: true,
    },
    sources: {
      type: 'array',
      description: 'Documentation sources the assistant cited',
      items: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Source identifier', nullable: true },
          url: { type: 'string', description: 'URL of the cited page', nullable: true },
          title: { type: 'string', description: 'Title of the cited page', nullable: true },
        },
      },
    },
  },
}
