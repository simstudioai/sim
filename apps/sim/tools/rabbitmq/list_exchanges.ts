import type {
  RabbitmqExchange,
  RabbitmqListExchangesParams,
  RabbitmqListExchangesResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  clampPageSize,
  extractErrorMessage,
  projectExchange,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_EXCHANGE_COLUMNS,
  RABBITMQ_EXCHANGE_OUTPUT_PROPERTIES,
  RABBITMQ_MAX_PAGE_SIZE,
  resolveVhost,
  unwrapPaginated,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_PAGE_SIZE = 50

export const rabbitmqListExchangesTool: ToolConfig<
  RabbitmqListExchangesParams,
  RabbitmqListExchangesResponse
> = {
  id: 'rabbitmq_list_exchanges',
  name: 'RabbitMQ List Exchanges',
  description:
    'List exchanges in a RabbitMQ virtual host with their type and declaration settings.',
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
      description: `Exchanges per page, from 1 to ${RABBITMQ_MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}`,
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter exchanges whose name contains this value',
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
      buildManagementUrl(host, ['exchanges', resolveVhost(vhost)], {
        page: page ?? 1,
        page_size: clampPageSize(pageSize, DEFAULT_PAGE_SIZE),
        name: name,
        use_regex: useRegex ? 'true' : undefined,
        columns: RABBITMQ_EXCHANGE_COLUMNS,
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
        output: { exchanges: [], count: 0, totalCount: null, page: null, pageCount: null },
        error,
      }
    }

    const data = await response.json()
    const { items, totalCount, page, pageCount } = unwrapPaginated<RabbitmqExchange>(data)
    const exchanges = items.map(projectExchange)

    return {
      success: true,
      output: { exchanges, count: exchanges.length, totalCount, page, pageCount },
    }
  },

  outputs: {
    exchanges: {
      type: 'array',
      description: 'Exchanges in the virtual host',
      items: { type: 'object', properties: RABBITMQ_EXCHANGE_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of exchanges returned on this page' },
    totalCount: {
      type: 'number',
      description: 'Total exchanges in the virtual host before filtering',
      optional: true,
    },
    page: { type: 'number', description: 'Page number returned', optional: true },
    pageCount: { type: 'number', description: 'Total number of pages', optional: true },
  },
}
