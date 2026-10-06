import type {
  PlaneSetCustomerPropertyValuesParams,
  PlaneSetCustomerPropertyValuesResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeSetCustomerPropertyValuesTool: ToolConfig<
  PlaneSetCustomerPropertyValuesParams,
  PlaneSetCustomerPropertyValuesResponse
> = {
  id: 'plane_set_customer_property_values',
  name: 'Plane Set customer property values',
  description: 'Set customer property values in Plane. Requires API v2.',
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
    customer_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The customer the resource belongs to.',
    },
    values: { type: 'json', required: true, visibility: 'user-or-llm', description: 'The values.' },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/${safeUrlPathSegment(params.customer_id, 'customer_id')}/property-values/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { values: { key: 'values', type: 'object', required: true } },
        params.bodyOverrides
      ),
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
