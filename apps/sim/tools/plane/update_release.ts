import { PLANEV2RELEASES2F1360_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Releases2f1360Schema } from '@/tools/plane/schemas'
import type { PlaneUpdateReleaseParams, PlaneUpdateReleaseResponse } from '@/tools/plane/types'
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

export const planeUpdateReleaseTool: ToolConfig<
  PlaneUpdateReleaseParams,
  PlaneUpdateReleaseResponse
> = {
  id: 'plane_update_release',
  name: 'Plane Update a release',
  description: 'Update a release in Plane. Supports API v1 compatibility.',
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
      description: 'The release id.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    description_json: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The description json.',
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
    is_latest: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is latest.',
    },
    is_prerelease: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is prerelease.',
    },
    lead_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related lead. Nullable.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    release_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The release date. Nullable.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `unreleased` - Unreleased - `released` - Released - `cancelled` - Cancelled One of `unreleased`, `released`, `cancelled`.',
    },
    tag_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related tag. Nullable.',
    },
    target_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned due date, as `YYYY-MM-DD`. Nullable.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description_html`, `description_id`, `external_id`, `external_source`, `id`, `is_latest`, `is_prerelease`, `label_ids`, `lead_id`, `name`, `release_date`, `status`, `tag_id`, `target_date`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `lead`, `tag`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    v1_description_json: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. JSON description of the release.',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. ID of the release tag associated with the release.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Description',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Start date',
    },
    logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Logo props',
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
              'pk',
              'name',
              'description_html',
              'v1_description_json',
              'status',
              'target_date',
              'release_date',
              'lead_id',
              'tag',
              'is_latest',
              'is_prerelease',
              'external_id',
              'external_source',
              'description',
              'start_date',
              'logo_props',
            ]
          : [
              'workspace_slug',
              'pk',
              'description_html',
              'description_json',
              'external_id',
              'external_source',
              'is_latest',
              'is_prerelease',
              'lead_id',
              'name',
              'release_date',
              'status',
              'tag_id',
              'target_date',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'pk',
          'description_html',
          'description_json',
          'external_id',
          'external_source',
          'is_latest',
          'is_prerelease',
          'lead_id',
          'name',
          'release_date',
          'status',
          'tag_id',
          'target_date',
          'fields',
          'expand',
          'v1_description_json',
          'tag',
          'description',
          'start_date',
          'logo_props',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
            })
          )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: false },
              description_html: { key: 'description_html', type: 'string', required: false },
              description_json: { key: 'v1_description_json', type: 'object', required: false },
              status: { key: 'status', type: 'string', required: false },
              target_date: { key: 'target_date', type: 'string', required: false },
              release_date: { key: 'release_date', type: 'string', required: false },
              lead: { key: 'lead_id', type: 'string', required: false },
              tag: { key: 'tag', type: 'string', required: false },
              is_latest: { key: 'is_latest', type: 'boolean', required: false },
              is_prerelease: { key: 'is_prerelease', type: 'boolean', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              description: { key: 'description', type: 'string', required: false },
              start_date: { key: 'start_date', type: 'string', required: false },
              logo_props: { key: 'logo_props', type: 'object', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              description_html: { key: 'description_html', type: 'string', required: false },
              description_json: { key: 'description_json', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              is_latest: { key: 'is_latest', type: 'boolean', required: false },
              is_prerelease: { key: 'is_prerelease', type: 'boolean', required: false },
              lead_id: { key: 'lead_id', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              release_date: { key: 'release_date', type: 'string', required: false },
              status: { key: 'status', type: 'string', required: false },
              tag_id: { key: 'tag_id', type: 'string', required: false },
              target_date: { key: 'target_date', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Releases2f1360Schema)
      : planeObjectResponse(response, planeV2Releases2f1360Schema),
  outputs: { result: PLANEV2RELEASES2F1360_OUTPUT },
}
