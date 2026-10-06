import { PLANEV2CUSTOMERS_OUTPUT } from '@/tools/plane/outputs'
import { planeV2CustomersSchema } from '@/tools/plane/schemas'
import type { PlaneUpsertCustomerParams, PlaneUpsertCustomerResponse } from '@/tools/plane/types'
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

export const planeUpsertCustomerTool: ToolConfig<
  PlaneUpsertCustomerParams,
  PlaneUpsertCustomerResponse
> = {
  id: 'plane_upsert_customer',
  name: 'Plane Upsert a customer',
  description: 'Upsert a customer in Plane. Requires API v2.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    contract_status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Current contract state, in your own vocabulary. Maximum 255 characters. Nullable.',
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
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The customer's primary domain, for example `example.com`. Maximum 255 characters. Nullable.",
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address. Nullable.',
    },
    employees: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Headcount, for segmentation. Nullable.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this record, for sync and import correlation. Maximum 255 characters. Nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The system `external_id` came from, for example `github` or `jira`. Maximum 255 characters. Nullable.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    revenue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Annual revenue, for segmentation. Nullable.',
    },
    stage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Where the customer sits in your funnel. Maximum 255 characters. Nullable.',
    },
    website_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public website URL. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `archived_at`, `contract_status`, `created_at`, `created_by_id`, `customer_request_count`, `description`, `description_html`, `domain`, `email`, `employees`, `external_id`, `external_source`, `id`, `logo_asset_id`, `logo_props`, `logo_url`, `name`, `revenue`, `stage`, `website_url`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customers/upsert/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          name: { key: 'name', type: 'string', required: true },
          contract_status: { key: 'contract_status', type: 'string', required: false },
          description: { key: 'description', type: 'string', required: false },
          description_html: { key: 'description_html', type: 'string', required: false },
          domain: { key: 'domain', type: 'string', required: false },
          email: { key: 'email', type: 'string', required: false },
          employees: { key: 'employees', type: 'integer', required: false },
          external_id: { key: 'external_id', type: 'string', required: false },
          external_source: { key: 'external_source', type: 'string', required: false },
          logo_props: { key: 'logo_props', type: 'string', required: false },
          revenue: { key: 'revenue', type: 'string', required: false },
          stage: { key: 'stage', type: 'string', required: false },
          website_url: { key: 'website_url', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, planeV2CustomersSchema),
  outputs: { result: PLANEV2CUSTOMERS_OUTPUT },
}
