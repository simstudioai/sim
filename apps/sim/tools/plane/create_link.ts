import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaneCreateLinkParams, PlaneLinkResponse } from '@/tools/plane/types'
import {
  mapPlaneLink,
  optionalTrimmed,
  PLANE_CONNECTION_PARAMS,
  PLANE_LINK_PROPERTIES,
  PLANE_PROJECT_ID_PARAM,
  PLANE_WORK_ITEM_ID_PARAM,
  planeHeaders,
  planeWorkItemUrl,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

export const planeCreateLinkTool: ToolConfig<PlaneCreateLinkParams, PlaneLinkResponse> = {
  id: 'plane_create_link',
  name: 'Plane Add Link',
  description: 'Attach an external URL (pull request, doc, ticket) to a Plane work item',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLANE_ERRORS,

  params: {
    ...PLANE_CONNECTION_PARAMS,
    ...PLANE_PROJECT_ID_PARAM,
    ...PLANE_WORK_ITEM_ID_PARAM,
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL to link (must start with http:// or https://)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display title for the link',
    },
  },

  request: {
    url: (params) => planeWorkItemUrl(params, 'links/'),
    method: 'POST',
    headers: planeHeaders,
    body: (params) => {
      const body: Record<string, unknown> = { url: params.url.trim() }
      const title = optionalTrimmed(params.title)
      if (title) body.title = title
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return { success: true, output: { link: mapPlaneLink(data) } }
  },

  outputs: {
    link: { type: 'object', description: 'The created link', properties: PLANE_LINK_PROPERTIES },
  },
}
