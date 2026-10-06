import { PLANEV2STICKIESF0CED7_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Stickiesf0ced7Schema } from '@/tools/plane/schemas'
import type { PlaneUpdateStickyParams, PlaneUpdateStickyResponse } from '@/tools/plane/types'
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

export const planeUpdateStickyTool: ToolConfig<PlaneUpdateStickyParams, PlaneUpdateStickyResponse> =
  {
    id: 'plane_update_sticky',
    name: 'Plane Update a sticky',
    description: 'Update a sticky in Plane. Supports API v1 compatibility.',
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
        description: 'The sticky id.',
      },
      background_color: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The background color. Maximum 255 characters. Nullable.',
      },
      color: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Hex color used wherever this is rendered, for example `#3f76ff`. Maximum 255 characters. Nullable.',
      },
      description_html: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
      },
      logo_props: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Editor-owned logo descriptor. Pass back what you read rather than composing it by hand.',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Display name. Nullable.',
      },
      sort_order: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Manual ordering weight. Lower sorts first.',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `background_color`, `color`, `created_at`, `created_by_id`, `description_html`, `description_stripped`, `id`, `logo_props`, `name`, `owner_id`, `sort_order`.',
      },
      deleted_at: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'v1 compatibility only. Deleted at.',
      },
      description: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'v1 compatibility only. Description.',
      },
      description_stripped: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'v1 compatibility only. Description stripped.',
      },
      v1_logo_props: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'v1 compatibility only. Logo props.',
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
      description_binary: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'v1 compatibility only. Description binary',
      },
    },
    request: {
      url: (params) => {
        const version = planeApiVersion(params.apiVersion, true)
        assertPlaneVersionFields(
          params,
          version === 'v1'
            ? [
                'pk',
                'workspace_slug',
                'deleted_at',
                'name',
                'description',
                'description_html',
                'description_stripped',
                'v1_logo_props',
                'color',
                'background_color',
                'sort_order',
                'created_by',
                'updated_by',
                'description_binary',
              ]
            : [
                'workspace_slug',
                'pk',
                'background_color',
                'color',
                'description_html',
                'logo_props',
                'name',
                'sort_order',
                'fields',
              ],
          [
            'workspace_slug',
            'pk',
            'background_color',
            'color',
            'description_html',
            'logo_props',
            'name',
            'sort_order',
            'fields',
            'deleted_at',
            'description',
            'description_stripped',
            'v1_logo_props',
            'created_by',
            'updated_by',
            'description_binary',
          ],
          version
        )
        return version === 'v1'
          ? planeApiUrl(
              params.baseUrl,
              `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/stickies/${safeUrlPathSegment(params.pk, 'pk')}/`
            )
          : planeApiUrl(
              params.baseUrl,
              `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/stickies/${safeUrlPathSegment(params.pk, 'pk')}/`,
              planeVersionedValues(params, {
                fields: { key: 'fields', type: 'string', required: false },
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
                deleted_at: { key: 'deleted_at', type: 'string', required: false },
                name: { key: 'name', type: 'string', required: false },
                description: { key: 'description', type: 'object', required: false },
                description_html: { key: 'description_html', type: 'string', required: false },
                description_stripped: {
                  key: 'description_stripped',
                  type: 'string',
                  required: false,
                },
                logo_props: { key: 'v1_logo_props', type: 'object', required: false },
                color: { key: 'color', type: 'string', required: false },
                background_color: { key: 'background_color', type: 'string', required: false },
                sort_order: { key: 'sort_order', type: 'number', required: false },
                created_by: { key: 'created_by', type: 'string', required: false },
                updated_by: { key: 'updated_by', type: 'string', required: false },
                description_binary: { key: 'description_binary', type: 'string', required: false },
              },
              params.bodyOverrides
            )
          : planeVersionedValues(
              params,
              {
                background_color: { key: 'background_color', type: 'string', required: false },
                color: { key: 'color', type: 'string', required: false },
                description_html: { key: 'description_html', type: 'string', required: false },
                logo_props: { key: 'logo_props', type: 'string', required: false },
                name: { key: 'name', type: 'string', required: false },
                sort_order: { key: 'sort_order', type: 'number', required: false },
              },
              params.bodyOverrides
            ),
    },
    transformResponse: async (response, params) =>
      planeApiVersion(params?.apiVersion, true) === 'v1'
        ? planeObjectResponse(response, planeV2Stickiesf0ced7Schema)
        : planeObjectResponse(response, planeV2Stickiesf0ced7Schema),
    outputs: { result: PLANEV2STICKIESF0CED7_OUTPUT },
  }
