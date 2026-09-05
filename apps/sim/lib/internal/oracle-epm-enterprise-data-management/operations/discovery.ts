import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import {
  edmApplicationSchema,
  edmPageSchema,
  edmViewpointSchema,
  edmViewSchema,
} from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import {
  type EdmInput,
  type EdmOperationContext,
  EdmOperationError,
  edmJsonData,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export function projectEdmList<T>(items: T[], maxResults: number, providerHasMore = false) {
  return {
    items: items.slice(0, maxResults),
    count: Math.min(items.length, maxResults),
    truncated: providerHasMore || items.length > maxResults,
  }
}

export async function readEdmApplications(context: EdmOperationContext, q?: string) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.applications, {
      query: { q },
      signal: context.signal,
    })
  )
  return edmPageSchema(edmApplicationSchema).parse(data)
}

export async function readEdmViews(context: EdmOperationContext, q?: string) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.views, { query: { q }, signal: context.signal })
  )
  return edmPageSchema(edmViewSchema).parse(data)
}

export async function readEdmViewpoints(viewId: string, context: EdmOperationContext, q?: string) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.viewpoints, {
      pathParams: { viewId },
      query: { q },
      signal: context.signal,
    })
  )
  return edmPageSchema(edmViewpointSchema).parse(data)
}

export async function listEdmApplications(
  input: EdmInput<'list_applications'>,
  context: EdmOperationContext
) {
  const q = input.applicationId
    ? `id::${input.applicationId}`
    : input.permission
      ? `permission::${input.permission}`
      : undefined
  const page = await readEdmApplications(context, q)
  return { applications: projectEdmList(page.items, input.maxResults, page.hasMore ?? false) }
}

export async function listEdmDimensions(
  input: EdmInput<'list_dimensions'>,
  context: EdmOperationContext
) {
  const page = await readEdmApplications(context, `id::${input.applicationId}`)
  const application = page.items.find(
    (item) => item.id.toLowerCase() === input.applicationId.toLowerCase()
  )
  if (!application) throw new EdmOperationError('The EDM application was not found', 404)
  return {
    applicationId: application.id,
    dimensions: projectEdmList(application.dimensions, input.maxResults),
  }
}

export async function listEdmViews(input: EdmInput<'list_views'>, context: EdmOperationContext) {
  const q = input.dimensionId
    ? `dimension::${input.dimensionId}`
    : input.objectStatus
      ? `objectStatus::${input.objectStatus}`
      : undefined
  const page = await readEdmViews(context, q)
  return { views: projectEdmList(page.items, input.maxResults, page.hasMore ?? false) }
}

export async function listEdmViewpoints(
  input: EdmInput<'list_viewpoints'>,
  context: EdmOperationContext
) {
  const q = input.dimensionId
    ? `dimension::${input.dimensionId}`
    : input.applicationId
      ? `application::${input.applicationId}`
      : undefined
  const page = await readEdmViewpoints(input.viewId, context, q)
  return { viewpoints: projectEdmList(page.items, input.maxResults, page.hasMore ?? false) }
}

export async function readEdmNodeTypes(
  viewId: string,
  viewpointId: string,
  context: EdmOperationContext
) {
  const page = await readEdmViewpoints(viewId, context)
  const viewpoint = page.items.find((item) => item.id.toLowerCase() === viewpointId.toLowerCase())
  if (!viewpoint)
    throw new EdmOperationError('The EDM viewpoint was not found in the returned view', 404)
  return viewpoint.nodeTypeAssignments.map((assignment) => ({
    ...assignment.nodeTypeLink,
    viewpointId: viewpoint.id,
    relatedViewpoints: assignment.relatedViewpoints,
  }))
}

export async function listEdmNodeTypes(
  input: EdmInput<'list_node_types'>,
  context: EdmOperationContext
) {
  return {
    nodeTypes: projectEdmList(
      await readEdmNodeTypes(input.viewId, input.viewpointId, context),
      input.maxResults
    ),
  }
}

export async function getEdmNodeType(
  input: EdmInput<'get_node_type'>,
  context: EdmOperationContext
) {
  const assignments = await readEdmNodeTypes(input.viewId, input.viewpointId, context)
  const nodeType = assignments.find(
    (item) => item.id.toLowerCase() === input.nodeTypeId.toLowerCase()
  )
  if (!nodeType)
    throw new EdmOperationError('The EDM node type is not assigned to the selected viewpoint', 404)
  return { nodeType }
}
