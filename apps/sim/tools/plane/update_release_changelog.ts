import { PLANEV2RELEASES6E73E7_OUTPUT } from '@/tools/plane/outputs'
import { planeV2Releases6e73e7Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateReleaseChangelogParams,
  PlaneUpdateReleaseChangelogResponse,
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

export const planeUpdateReleaseChangelogTool: ToolConfig<
  PlaneUpdateReleaseChangelogParams,
  PlaneUpdateReleaseChangelogResponse
> = {
  id: 'plane_update_release_changelog',
  name: 'Plane Update a release changelog',
  description: 'Update a release changelog in Plane. Supports API v1 compatibility.',
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
      description: 'The release changelog id.',
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
    v1_description_json: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'v1 compatibility only. Rich-text JSON content for the changelog. Write-only; the stored value is returned in the response as the nested `changelog` object.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'description_html', 'v1_description_json']
          : ['workspace_slug', 'pk', 'description_html', 'description_json'],
        ['workspace_slug', 'pk', 'description_html', 'description_json', 'v1_description_json'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/changelog/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/changelog/`
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
              description_html: { key: 'description_html', type: 'string', required: false },
              description_json: { key: 'v1_description_json', type: 'object', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              description_html: { key: 'description_html', type: 'string', required: false },
              description_json: { key: 'description_json', type: 'string', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2Releases6e73e7Schema)
      : planeObjectResponse(response, planeV2Releases6e73e7Schema),
  outputs: { result: PLANEV2RELEASES6E73E7_OUTPUT },
}
