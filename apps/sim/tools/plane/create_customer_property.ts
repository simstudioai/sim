import { PLANEV2CUSTOMERPROPERTIES2DC1F6_OUTPUT } from '@/tools/plane/outputs'
import { planeV2CustomerProperties2dc1f6Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateCustomerPropertyParams,
  PlaneCreateCustomerPropertyResponse,
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

export const planeCreateCustomerPropertyTool: ToolConfig<
  PlaneCreateCustomerPropertyParams,
  PlaneCreateCustomerPropertyResponse
> = {
  id: 'plane_create_customer_property',
  name: 'Plane Create a customer property',
  description: 'Create a customer property in Plane. Supports API v1 compatibility.',
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
    display_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The display name. Maximum 255 characters.',
    },
    property_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        '- `TEXT` - Text - `DATETIME` - Datetime - `DECIMAL` - Decimal - `BOOLEAN` - Boolean - `OPTION` - Option - `RELATION` - Relation - `URL` - URL - `EMAIL` - Email - `FILE` - File One of `TEXT`, `DATETIME`, `DECIMAL`, `BOOLEAN`, `OPTION`, `RELATION`, `URL`, `EMAIL`, `FILE`.',
    },
    default_value: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The default value.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form description. Nullable.',
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
    is_active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the record is active.',
    },
    is_multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is multi.',
    },
    is_required: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is required.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    options: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The options.',
    },
    relation_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: '- `ISSUE` - Issue - `USER` - User One of `ISSUE`, `USER`. Nullable.',
    },
    settings: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The settings.',
    },
    validation_rules: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The validation rules.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `default_value`, `description`, `display_name`, `external_id`, `external_source`, `id`, `is_active`, `is_multi`, `is_required`, `logo_props`, `name`, `options`, `property_type`, `relation_type`, `settings`, `sort_order`, `validation_rules`.',
    },
    v1_logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Logo props.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Sort order.',
    },
    v1_settings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Settings.',
    },
    v1_validation_rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Validation rules.',
    },
    created_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Created by.',
    },
    updated_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Updated by.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Name',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'workspace_slug',
              'display_name',
              'description',
              'v1_logo_props',
              'sort_order',
              'property_type',
              'relation_type',
              'is_required',
              'default_value',
              'v1_settings',
              'is_active',
              'is_multi',
              'v1_validation_rules',
              'external_source',
              'external_id',
              'created_by',
              'updated_by',
              'name',
              'options',
            ]
          : [
              'workspace_slug',
              'display_name',
              'property_type',
              'default_value',
              'description',
              'external_id',
              'external_source',
              'is_active',
              'is_multi',
              'is_required',
              'logo_props',
              'options',
              'relation_type',
              'settings',
              'validation_rules',
              'fields',
            ],
        [
          'workspace_slug',
          'display_name',
          'property_type',
          'default_value',
          'description',
          'external_id',
          'external_source',
          'is_active',
          'is_multi',
          'is_required',
          'logo_props',
          'options',
          'relation_type',
          'settings',
          'validation_rules',
          'fields',
          'v1_logo_props',
          'sort_order',
          'v1_settings',
          'v1_validation_rules',
          'created_by',
          'updated_by',
          'name',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customer-properties/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/customer-properties/`,
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
              display_name: { key: 'display_name', type: 'string', required: true },
              description: { key: 'description', type: 'string', required: false },
              logo_props: { key: 'v1_logo_props', type: 'object', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
              property_type: { key: 'property_type', type: 'string', required: true },
              relation_type: { key: 'relation_type', type: 'string', required: false },
              is_required: { key: 'is_required', type: 'boolean', required: false },
              default_value: { key: 'default_value', type: 'array', required: false },
              settings: { key: 'v1_settings', type: 'object', required: false },
              is_active: { key: 'is_active', type: 'boolean', required: false },
              is_multi: { key: 'is_multi', type: 'boolean', required: false },
              validation_rules: { key: 'v1_validation_rules', type: 'object', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              created_by: { key: 'created_by', type: 'string', required: false },
              updated_by: { key: 'updated_by', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              options: { key: 'options', type: 'array', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              display_name: { key: 'display_name', type: 'string', required: true },
              property_type: { key: 'property_type', type: 'string', required: true },
              default_value: { key: 'default_value', type: 'array', required: false },
              description: { key: 'description', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              is_active: { key: 'is_active', type: 'boolean', required: false },
              is_multi: { key: 'is_multi', type: 'boolean', required: false },
              is_required: { key: 'is_required', type: 'boolean', required: false },
              logo_props: { key: 'logo_props', type: 'string', required: false },
              options: { key: 'options', type: 'array', required: false },
              relation_type: { key: 'relation_type', type: 'string', required: false },
              settings: { key: 'settings', type: 'string', required: false },
              validation_rules: { key: 'validation_rules', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2CustomerProperties2dc1f6Schema)
      : planeObjectResponse(response, planeV2CustomerProperties2dc1f6Schema),
  outputs: { result: PLANEV2CUSTOMERPROPERTIES2DC1F6_OUTPUT },
}
