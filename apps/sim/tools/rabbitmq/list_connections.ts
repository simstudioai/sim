import type {
  RabbitmqConnection,
  RabbitmqListConnectionsParams,
  RabbitmqListConnectionsResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  clampPageSize,
  extractErrorMessage,
  projectConnection,
  RABBITMQ_CONNECTION_COLUMNS,
  RABBITMQ_CONNECTION_OUTPUT_PROPERTIES,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_MAX_PAGE_SIZE,
  unwrapPaginated,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_PAGE_SIZE = 50

export const rabbitmqListConnectionsTool: ToolConfig<
  RabbitmqListConnectionsParams,
  RabbitmqListConnectionsResponse
> = {
  id: 'rabbitmq_list_connections',
  name: 'RabbitMQ List Connections',
  description:
    'List client connections to the broker with their user, state, and channel count. Connections are cluster-wide, not scoped to one virtual host.',
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
      description: `Connections per page, from 1 to ${RABBITMQ_MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}`,
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter connections whose name contains this value',
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
      buildManagementUrl(host, ['connections'], {
        page: page ?? 1,
        page_size: clampPageSize(pageSize, DEFAULT_PAGE_SIZE),
        name: name,
        use_regex: useRegex ? 'true' : undefined,
        columns: RABBITMQ_CONNECTION_COLUMNS,
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
        output: { connections: [], count: 0, totalCount: null, page: null, pageCount: null },
        error,
      }
    }

    const data = await response.json()
    const { items, totalCount, page, pageCount } = unwrapPaginated<RabbitmqConnection>(data)
    const connections = items.map(projectConnection)

    return {
      success: true,
      output: { connections, count: connections.length, totalCount, page, pageCount },
    }
  },

  outputs: {
    connections: {
      type: 'array',
      description: 'Open client connections',
      items: { type: 'object', properties: RABBITMQ_CONNECTION_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of connections returned on this page' },
    totalCount: {
      type: 'number',
      description: 'Total connections before filtering',
      optional: true,
    },
    page: { type: 'number', description: 'Page number returned', optional: true },
    pageCount: { type: 'number', description: 'Total number of pages', optional: true },
  },
}
