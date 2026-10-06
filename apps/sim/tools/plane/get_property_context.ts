import { PLANEV2WORKITEMPROPERTYCONTEXTS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemPropertyContextsSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetPropertyContextParams,
  PlaneGetPropertyContextResponse,
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

export const planeGetPropertyContextTool: ToolConfig<
  PlaneGetPropertyContextParams,
  PlaneGetPropertyContextResponse
> = {
  id: 'plane_get_property_context',
  name: 'Plane Get a property context',
  description: 'Get a property context in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
    workspace_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace slug from the Plane URL (for example, my-team).',
    },
    property_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The workspace-level property the context belongs to. A project-level property id is not addressable here and returns `404 not_found`.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The id of the context to retrieve. A context that belongs to a different property returns `404`, even if the id exists.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `applies_to_all_projects`, `applies_to_all_work_item_types`, `created_at`, `default_value`, `external_id`, `external_source`, `id`, `is_default`, `is_multi`, `is_required`, `issue_type_ids`, `name`, `options`, `project_ids`, `settings`, `sort_order`. See [Sparse fields](/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-item-properties/${safeUrlPathSegment(params.property_id, 'property_id')}/contexts/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkItemPropertyContextsSchema),
  outputs: { result: PLANEV2WORKITEMPROPERTYCONTEXTS_OUTPUT },
}
