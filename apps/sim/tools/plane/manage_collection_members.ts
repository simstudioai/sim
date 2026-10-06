import { PLANEV2V2MANAGECOLLECTIONMEMBERSRESULT8B24A1_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2ManageCollectionMembersresult8b24a1Schema } from '@/tools/plane/schemas'
import type {
  PlaneManageCollectionMembersParams,
  PlaneManageCollectionMembersResponse,
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

export const planeManageCollectionMembersTool: ToolConfig<
  PlaneManageCollectionMembersParams,
  PlaneManageCollectionMembersResponse
> = {
  id: 'plane_manage_collection_members',
  name: 'Plane Add or remove collection members',
  description: 'Add or remove collection members in Plane. Supports API v1 compatibility.',
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
      description: 'The collection member id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
    member: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "v1 compatibility only. The workspace user's ID.",
    },
    access: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. `0` (view, default), `1` (comment), or `2` (edit).',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['workspace_slug', 'pk', 'member', 'access']
          : ['workspace_slug', 'pk', 'add', 'remove'],
        ['workspace_slug', 'pk', 'add', 'remove', 'member', 'access'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/members/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.pk, 'pk')}/members/`
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
              member: { key: 'member', type: 'string', required: true },
              access: { key: 'access', type: 'integer', required: false },
            },
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
      ? planeObjectResponse(response, planeV2V2ManageCollectionMembersresult8b24a1Schema)
      : planeObjectResponse(response, planeV2V2ManageCollectionMembersresult8b24a1Schema),
  outputs: { result: PLANEV2V2MANAGECOLLECTIONMEMBERSRESULT8B24A1_OUTPUT },
}
