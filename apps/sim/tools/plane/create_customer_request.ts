import { PLANEV2CUSTOMERREQUESTS7999A5_OUTPUT } from '@/tools/plane/outputs'
import { planeV2CustomerRequests7999a5Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateCustomerRequestParams,
  PlaneCreateCustomerRequestResponse,
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
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeCreateCustomerRequestTool: ToolConfig<
  PlaneCreateCustomerRequestParams,
  PlaneCreateCustomerRequestResponse
> = {
  id: 'plane_create_customer_request',
  name: 'Plane Create a customer request',
  description: 'Create a customer request in Plane. Supports API v1 compatibility.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description. Nullable.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Rich-text body as HTML. This is the field the Plane editor round-trips. Nullable.',
    },
    link: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The link. Nullable.',
    },
    work_item_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ids of the work items to associate. Replaces the current set.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `created_at`, `created_by_id`, `customer_id`, `description`, `description_html`, `id`, `link`, `name`.',
    },
    v1_description: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Description.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'customer_id',
              'workspace_slug',
              'name',
              'v1_description',
              'description_html',
              'link',
              'work_item_ids',
            ]
          : [
              'workspace_slug',
              'customer_id',
              'name',
              'description',
              'description_html',
              'link',
              'work_item_ids',
              'fields',
            ],
        [
          'workspace_slug',
          'customer_id',
          'name',
          'description',
          'description_html',
          'link',
          'work_item_ids',
          'fields',
          'v1_description',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/${safeUrlPathSegment(params.customer_id, 'customer_id')}/requests/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/${safeUrlPathSegment(params.customer_id, 'customer_id')}/requests/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              description: { key: 'v1_description', type: 'object', required: false },
              description_html: { key: 'description_html', type: 'string', required: false },
              link: { key: 'link', type: 'string', required: false },
              work_item_ids: { key: 'work_item_ids', type: 'array', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              description: { key: 'description', type: 'string', required: false },
              description_html: { key: 'description_html', type: 'string', required: false },
              link: { key: 'link', type: 'string', required: false },
              work_item_ids: { key: 'work_item_ids', type: 'array', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2CustomerRequests7999a5Schema)
      : planeObjectResponse(response, planeV2CustomerRequests7999a5Schema),
  outputs: { result: PLANEV2CUSTOMERREQUESTS7999A5_OUTPUT },
}
