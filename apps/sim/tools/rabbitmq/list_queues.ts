import type {
  RabbitmqListQueuesParams,
  RabbitmqListQueuesResponse,
  RabbitmqQueue,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  clampPageSize,
  extractErrorMessage,
  projectQueue,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_MAX_PAGE_SIZE,
  RABBITMQ_QUEUE_COLUMNS,
  RABBITMQ_QUEUE_OUTPUT_PROPERTIES,
  resolveVhost,
  unwrapPaginated,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_PAGE_SIZE = 50

export const rabbitmqListQueuesTool: ToolConfig<
  RabbitmqListQueuesParams,
  RabbitmqListQueuesResponse
> = {
  id: 'rabbitmq_list_queues',
  name: 'RabbitMQ List Queues',
  description:
    'List queues in a RabbitMQ virtual host with their depth, consumer count, and configuration.',
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
      description: `Queues per page, from 1 to ${RABBITMQ_MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}`,
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter queues whose name contains this value',
    },
    useRegex: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Treat the name filter as a regular expression',
    },
  },

  request: {
    url: ({ host, vhost, name, page, pageSize, useRegex }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost)], {
        page: page ?? 1,
        page_size: clampPageSize(pageSize, DEFAULT_PAGE_SIZE),
        name: name,
        use_regex: useRegex ? 'true' : undefined,
        columns: RABBITMQ_QUEUE_COLUMNS,
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
        output: { queues: [], count: 0, totalCount: null, page: null, pageCount: null },
        error,
      }
    }

    const data = await response.json()
    const { items, totalCount, page, pageCount } = unwrapPaginated<RabbitmqQueue>(data)
    const queues = items.map(projectQueue)

    return {
      success: true,
      output: { queues, count: queues.length, totalCount, page, pageCount },
    }
  },

  outputs: {
    queues: {
      type: 'array',
      description: 'Queues in the virtual host',
      items: { type: 'object', properties: RABBITMQ_QUEUE_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of queues returned on this page' },
    totalCount: {
      type: 'number',
      description: 'Total queues in the virtual host before filtering',
      optional: true,
    },
    page: { type: 'number', description: 'Page number returned', optional: true },
    pageCount: { type: 'number', description: 'Total number of pages', optional: true },
  },
}
