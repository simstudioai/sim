import { PLANEV2WORKSPACEPAGESD6A399_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspacePagesd6a399Schema } from '@/tools/plane/schemas'
import type {
  PlaneCreateWorkspacePageParams,
  PlaneCreateWorkspacePageResponse,
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

export const planeCreateWorkspacePageTool: ToolConfig<
  PlaneCreateWorkspacePageParams,
  PlaneCreateWorkspacePageResponse
> = {
  id: 'plane_create_workspace_page',
  name: 'Plane Create a workspace page',
  description: 'Create a workspace page in Plane. Supports API v1 compatibility.',
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
      description: 'Display name.',
    },
    access: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can see this.',
    },
    archived_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The archived at. Nullable.',
    },
    collection_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related collection. Nullable.',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hex color used wherever this is rendered, for example `#3f76ff`. Maximum 255 characters.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
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
    is_locked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prevents further edits to the content.',
    },
    logo_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
    },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related parent. Nullable.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Manual ordering weight. Lower sorts first.',
    },
    view_props: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Editor-owned layout descriptor. Pass back what you read.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `access`, `archived_at`, `collection_id`, `color`, `created_at`, `created_by_id`, `description_html`, `description_stripped`, `external_id`, `external_source`, `id`, `is_global`, `is_locked`, `logo_props`, `name`, `owned_by_id`, `parent_id`, `sort_order`, `view_props`.',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated relations to embed: `owned_by`, `parent`. Expansion is separate-key — `?expand=state` keeps `state_id` and adds a `state` object next to it. `?fields=` and `?expand=` are independent: naming a relation in `?fields=` is a `400`, and expanded objects survive field filtering. See [Expanding relations](/api-reference/v2/expanding-relations).',
    },
    v1_access: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. - `0` - Public - `1` - Private',
    },
    v1_view_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. View props.',
    },
    v1_logo_props: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Logo props.',
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
              'name',
              'v1_access',
              'color',
              'is_locked',
              'archived_at',
              'v1_view_props',
              'v1_logo_props',
              'external_id',
              'external_source',
              'description_html',
              'parent_id',
              'collection_id',
            ]
          : [
              'workspace_slug',
              'name',
              'access',
              'archived_at',
              'collection_id',
              'color',
              'description_html',
              'external_id',
              'external_source',
              'is_locked',
              'logo_props',
              'parent_id',
              'sort_order',
              'view_props',
              'fields',
              'expand',
            ],
        [
          'workspace_slug',
          'name',
          'access',
          'archived_at',
          'collection_id',
          'color',
          'description_html',
          'external_id',
          'external_source',
          'is_locked',
          'logo_props',
          'parent_id',
          'sort_order',
          'view_props',
          'fields',
          'expand',
          'v1_access',
          'v1_view_props',
          'v1_logo_props',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/pages/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
              expand: { key: 'expand', type: 'string', required: false },
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
              access: { key: 'v1_access', type: 'integer', required: false },
              color: { key: 'color', type: 'string', required: false },
              is_locked: { key: 'is_locked', type: 'boolean', required: false },
              archived_at: { key: 'archived_at', type: 'string', required: false },
              view_props: { key: 'v1_view_props', type: 'object', required: false },
              logo_props: { key: 'v1_logo_props', type: 'object', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              description_html: { key: 'description_html', type: 'string', required: true },
              parent_id: { key: 'parent_id', type: 'string', required: false },
              collection_id: { key: 'collection_id', type: 'string', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              name: { key: 'name', type: 'string', required: true },
              access: { key: 'access', type: 'string', required: false },
              archived_at: { key: 'archived_at', type: 'string', required: false },
              collection_id: { key: 'collection_id', type: 'string', required: false },
              color: { key: 'color', type: 'string', required: false },
              description_html: { key: 'description_html', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              is_locked: { key: 'is_locked', type: 'boolean', required: false },
              logo_props: { key: 'logo_props', type: 'string', required: false },
              parent_id: { key: 'parent_id', type: 'string', required: false },
              sort_order: { key: 'sort_order', type: 'number', required: false },
              view_props: { key: 'view_props', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkspacePagesd6a399Schema)
      : planeObjectResponse(response, planeV2WorkspacePagesd6a399Schema),
  outputs: { result: PLANEV2WORKSPACEPAGESD6A399_OUTPUT },
}
