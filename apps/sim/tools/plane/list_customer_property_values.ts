import { LISTCUSTOMERPROPERTYVALUESRESULT_OUTPUT } from '@/tools/plane/outputs'
import { listCustomerPropertyValuesResultSchema } from '@/tools/plane/schemas'
import type {
  PlaneListCustomerPropertyValuesParams,
  PlaneListCustomerPropertyValuesResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeListCustomerPropertyValuesTool: ToolConfig<
  PlaneListCustomerPropertyValuesParams,
  PlaneListCustomerPropertyValuesResponse
> = {
  id: 'plane_list_customer_property_values',
  name: 'Plane List customer property values',
  description: 'List customer property values in Plane. Supports API v1 compatibility.',
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
    customer_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The customer the resource belongs to.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1' ? ['customer_id', 'workspace_slug'] : ['workspace_slug', 'customer_id'],
        ['workspace_slug', 'customer_id'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/${safeUrlPathSegment(params.customer_id, 'customer_id')}/property-values/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/${safeUrlPathSegment(params.customer_id, 'customer_id')}/property-values/`
          )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, listCustomerPropertyValuesResultSchema)
      : planeObjectResponse(response, listCustomerPropertyValuesResultSchema),
  outputs: { result: LISTCUSTOMERPROPERTYVALUESRESULT_OUTPUT },
}
