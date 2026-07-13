import { filterUndefined } from '@sim/utils/object'
import type {
  FlintGeneratePagesItem,
  FlintGeneratePagesParams,
  FlintGeneratePagesResponse,
} from '@/tools/flint/types'
import { FLINT_API_BASE_URL, flintBaseParamFields, flintHeaders } from '@/tools/flint/utils'
import type { ToolConfig } from '@/tools/types'

const MAX_ITEMS = 10

/**
 * Parses and validates the items input, which may arrive as a JSON string
 * from the block's code input or as an already-structured array.
 */
function parseItems(input: FlintGeneratePagesItem[] | string): FlintGeneratePagesItem[] {
  let items: unknown
  try {
    items = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    throw new Error('Invalid JSON in items parameter')
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty JSON array of { targetPageSlug, context } objects')
  }
  if (items.length > MAX_ITEMS) {
    throw new Error(`items supports at most ${MAX_ITEMS} pages per task`)
  }
  for (const item of items) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as FlintGeneratePagesItem).targetPageSlug !== 'string' ||
      typeof (item as FlintGeneratePagesItem).context !== 'string'
    ) {
      throw new Error('Each item must include string targetPageSlug and context fields')
    }
  }
  return items as FlintGeneratePagesItem[]
}

export const flintGeneratePagesTool: ToolConfig<
  FlintGeneratePagesParams,
  FlintGeneratePagesResponse
> = {
  id: 'flint_generate_pages',
  name: 'Flint Generate Pages',
  description:
    'Start a background Flint agent task that generates up to 10 pages from a template page.',
  version: '1.0.0',

  params: {
    ...flintBaseParamFields,
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the Flint site the agent should modify',
    },
    templatePageSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Slug of the existing template page to generate from (e.g., /case-studies/template)',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of 1-10 pages to generate. Each item requires targetPageSlug (slug for the new page) and context (content details the agent should use).',
      items: {
        type: 'object',
        properties: {
          targetPageSlug: { type: 'string', description: 'Slug for the generated page' },
          context: { type: 'string', description: 'Content context for the generated page' },
        },
      },
    },
    callbackUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS webhook URL that Flint will POST to when the task completes or fails',
    },
    publish: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to automatically publish the generated pages when the task completes',
    },
  },

  request: {
    url: `${FLINT_API_BASE_URL}/agent/tasks`,
    method: 'POST',
    headers: (params) => flintHeaders(params),
    body: (params) =>
      filterUndefined({
        siteId: params.siteId,
        command: 'generate_pages',
        templatePageSlug: params.templatePageSlug,
        items: parseItems(params.items),
        callbackUrl: params.callbackUrl,
        publish: params.publish,
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskId: data.taskId ?? null,
        status: data.status ?? null,
        createdAt: data.createdAt ?? null,
      },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'Identifier of the created background task' },
    status: { type: 'string', description: 'Initial task status (running)' },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp when the task was created' },
  },
}
