import { PLANEV2V2ATTACHTYPEPROPERTYRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2AttachTypePropertyresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneAttachTypePropertyParams,
  PlaneAttachTypePropertyResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeAttachTypePropertyTool: ToolConfig<
  PlaneAttachTypePropertyParams,
  PlaneAttachTypePropertyResponse
> = {
  id: 'plane_attach_type_property',
  name: 'Plane Attach a property to a type',
  description: 'Attach a property to a type in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    bodyOverrides: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON overrides using the canonical input names for the selected API version. Preserves empty strings, null, and empty arrays; unsupported fields are rejected.',
    },
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project the work item type belongs to.',
    },
    type_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The work item type to attach the properties to.',
    },
    properties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ids of the properties to attach. Every id must belong to a property in **this project** — an id from another project or another workspace fails the whole request with `400 invalid_request`, and nothing is attached. Nothing is attached partially: either all the ids are valid or none are applied. The array cannot be empty. Attaching an id the type already exposes is not an error and does not create a duplicate, so retrying a request that may have already landed is safe.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-types/${safeUrlPathSegment(params.type_id, 'type_id')}/properties/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { properties: { key: 'properties', type: 'array', required: true } },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2AttachTypePropertyresultSchema),
  outputs: { result: PLANEV2V2ATTACHTYPEPROPERTYRESULT_OUTPUT },
}
