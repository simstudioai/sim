import {
  PLANEV2V2MANAGERELEASELABELSRESULT_OUTPUT,
  RELEASELABEL1B6179_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ManageReleaseLabelsresultSchema,
  releaseLabel1b6179Schema,
} from '@/tools/plane/schemas'
import type {
  PlaneManageReleaseLabelsParams,
  PlaneManageReleaseLabelsResponse,
} from '@/tools/plane/types'
import {
  assertPlaneVersionFields,
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeListResponse,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeManageReleaseLabelsTool: ToolConfig<
  PlaneManageReleaseLabelsParams,
  PlaneManageReleaseLabelsResponse
> = {
  id: 'plane_manage_release_labels',
  name: 'Plane Add or remove release labels',
  description: 'Add or remove release labels in Plane. Supports API v1 compatibility.',
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
      description: 'The release label id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
    label_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Array of release label IDs to add to the release.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'label_ids']
          : ['workspace_slug', 'pk', 'add', 'remove'],
        ['workspace_slug', 'pk', 'add', 'remove', 'label_ids'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/labels/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/releases/${safeUrlPathSegment(params.pk, 'pk')}/labels/`
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            { label_ids: { key: 'label_ids', type: 'array', required: true } },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              add: { key: 'add', type: 'array', required: false },
              remove: { key: 'remove', type: 'array', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeListResponse(response, releaseLabel1b6179Schema, false, false)
      : planeObjectResponse(response, planeV2V2ManageReleaseLabelsresultSchema),
  outputs: {
    result: PLANEV2V2MANAGERELEASELABELSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: RELEASELABEL1B6179_OUTPUT.type,
        description: RELEASELABEL1B6179_OUTPUT.description,
        properties: RELEASELABEL1B6179_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
