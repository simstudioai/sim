import type { RabbitmqListNodesParams, RabbitmqListNodesResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectNode,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_NODE_COLUMNS,
  RABBITMQ_NODE_OUTPUT_PROPERTIES,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqListNodesTool: ToolConfig<RabbitmqListNodesParams, RabbitmqListNodesResponse> =
  {
    id: 'rabbitmq_list_nodes',
    name: 'RabbitMQ List Nodes',
    description:
      'List the cluster nodes with memory, disk, file-descriptor, and alarm state. A fired alarm blocks publishers broker-wide.',
    version: '1.0.0',

    params: { ...RABBITMQ_CONNECTION_PARAMS },

    request: {
      url: ({ host }) => buildManagementUrl(host, ['nodes'], { columns: RABBITMQ_NODE_COLUMNS }),
      method: 'GET',
      headers: ({ username, password }) => buildAuthHeaders(username, password),
      stripAuthOnRedirect: true,
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const error = await extractErrorMessage(response)
        return { success: false, output: { nodes: [], count: 0 }, error }
      }

      const data = await response.json()
      const nodes = Array.isArray(data) ? data.map(projectNode) : []

      return { success: true, output: { nodes, count: nodes.length } }
    },

    outputs: {
      nodes: {
        type: 'array',
        description: 'Cluster nodes and their resource headroom',
        items: { type: 'object', properties: RABBITMQ_NODE_OUTPUT_PROPERTIES },
      },
      count: { type: 'number', description: 'Number of nodes in the cluster' },
    },
  }
