import { PLANEV2V2MANAGECUSTOMERWORKITEMSRESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ManageCustomerWorkItemsresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneManageCustomerWorkItemsParams,
  PlaneManageCustomerWorkItemsResponse,
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

export const planeManageCustomerWorkItemsTool: ToolConfig<
  PlaneManageCustomerWorkItemsParams,
  PlaneManageCustomerWorkItemsResponse
> = {
  id: 'plane_manage_customer_work_items',
  name: 'Plane Link or unlink customer work items',
  description: 'Link or unlink customer work items in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The customer work item id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/${safeUrlPathSegment(params.pk, 'pk')}/work-items/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          add: { key: 'add', type: 'array', required: false },
          remove: { key: 'remove', type: 'array', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2ManageCustomerWorkItemsresultSchema),
  outputs: { result: PLANEV2V2MANAGECUSTOMERWORKITEMSRESULT_OUTPUT },
}
