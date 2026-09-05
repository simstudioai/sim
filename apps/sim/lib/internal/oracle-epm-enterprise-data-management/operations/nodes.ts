import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { browseEdmHierarchy } from '@/lib/internal/oracle-epm-enterprise-data-management/hierarchy'
import {
  edmNodeSchema,
  edmPageSchema,
} from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import {
  type EdmInput,
  type EdmOperationContext,
  edmJsonData,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function readEdmNodePage(
  input: {
    viewId: string
    viewpointId: string
    q: string
    limit: number
    offset: number
    expand?: string
    fromId?: string
    toId?: string
    orderBy?: string
  },
  context: EdmOperationContext
) {
  const { viewId, viewpointId, ...query } = input
  const data = edmJsonData(
    await context.client.request(edmEndpoints.nodes, {
      pathParams: { viewId, viewpointId },
      query,
      signal: context.signal,
    })
  )
  return edmPageSchema(edmNodeSchema).parse(data)
}

export async function listEdmNodes(input: EdmInput<'list_nodes'>, context: EdmOperationContext) {
  const q =
    input.scope === 'children'
      ? `childrenOfNode::${input.parentNodeId}`
      : input.scope === 'request'
        ? `request::${input.requestId}`
        : input.scope
  const page = await readEdmNodePage(
    {
      viewId: input.viewId,
      viewpointId: input.viewpointId,
      q,
      limit: input.limit,
      offset: input.offset,
      expand: input.expand ?? 'propertyValues::none',
      fromId: input.fromId,
      toId: input.toId,
      orderBy: input.orderBy,
    },
    context
  )
  const nodes = page.items.slice(0, input.limit)
  const hasMore = page.hasMore ?? page.items.length >= input.limit
  return {
    nodes,
    count: nodes.length,
    offset: input.offset,
    hasMore,
    nextOffset: hasMore ? input.offset + nodes.length : null,
    truncated: page.items.length > input.limit,
  }
}

export async function getEdmNode(
  input: EdmInput<'get_node'> | EdmInput<'get_node_at_location'>,
  context: EdmOperationContext
) {
  const atLocation = input.operation === 'oracle_epm_edm_get_node_at_location'
  const data = edmJsonData(
    await context.client.request(atLocation ? edmEndpoints.nodeAtLocation : edmEndpoints.node, {
      pathParams: {
        viewId: input.viewId,
        viewpointId: input.viewpointId,
        nodeId: input.nodeId,
        ...(atLocation ? { location: input.location } : {}),
      },
      query: {
        q: input.requestId ? `request::${input.requestId}` : undefined,
        expand: input.expand,
      },
      signal: context.signal,
    })
  )
  return { node: edmNodeSchema.parse(data) }
}

export async function browseEdmNodes(
  input: EdmInput<'browse_hierarchy'>,
  context: EdmOperationContext
) {
  return browseEdmHierarchy(
    input,
    (frontier, limit) =>
      readEdmNodePage(
        {
          viewId: input.viewId,
          viewpointId: input.viewpointId,
          q: frontier.parentNodeId ? `childrenOfNode::${frontier.parentNodeId}` : 'top',
          limit,
          offset: frontier.offset,
          expand: 'propertyValues::none',
        },
        context
      ),
    context.signal
  )
}
