import type {
  RabbitmqChannel,
  RabbitmqListChannelsParams,
  RabbitmqListChannelsResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  clampPageSize,
  extractErrorMessage,
  projectChannel,
  RABBITMQ_CHANNEL_COLUMNS,
  RABBITMQ_CHANNEL_OUTPUT_PROPERTIES,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_MAX_PAGE_SIZE,
  unwrapPaginated,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_PAGE_SIZE = 50

export const rabbitmqListChannelsTool: ToolConfig<
  RabbitmqListChannelsParams,
  RabbitmqListChannelsResponse
> = {
  id: 'rabbitmq_list_channels',
  name: 'RabbitMQ List Channels',
  description:
    'List open channels with their prefetch limit and unacknowledged message count, which is where stalled consumers show up. Channels are cluster-wide, not scoped to one virtual host.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page of results to return, starting at 1',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: `Channels per page, from 1 to ${RABBITMQ_MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}`,
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter channels whose name contains this value',
    },
    useRegex: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Treat the name filter as a regular expression',
    },
  },

  request: {
    url: ({ host, name, page, pageSize, useRegex }) =>
      buildManagementUrl(host, ['channels'], {
        page: page ?? 1,
        page_size: clampPageSize(pageSize, DEFAULT_PAGE_SIZE),
        name: name,
        use_regex: useRegex ? 'true' : undefined,
        columns: RABBITMQ_CHANNEL_COLUMNS,
      }),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return {
        success: false,
        output: { channels: [], count: 0, totalCount: null, page: null, pageCount: null },
        error,
      }
    }

    const data = await response.json()
    const { items, totalCount, page, pageCount } = unwrapPaginated<RabbitmqChannel>(data)
    const channels = items.map(projectChannel)

    return {
      success: true,
      output: { channels, count: channels.length, totalCount, page, pageCount },
    }
  },

  outputs: {
    channels: {
      type: 'array',
      description: 'Open channels',
      items: { type: 'object', properties: RABBITMQ_CHANNEL_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of channels returned on this page' },
    totalCount: { type: 'number', description: 'Total channels before filtering', optional: true },
    page: { type: 'number', description: 'Page number returned', optional: true },
    pageCount: { type: 'number', description: 'Total number of pages', optional: true },
  },
}
