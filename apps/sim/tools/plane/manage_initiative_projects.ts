import {
  PLANEV2V2MANAGEINITIATIVEPROJECTSRESULT_OUTPUT,
  PROJECT51FEA9_OUTPUT,
} from '@/tools/plane/outputs'
import {
  planeV2V2ManageInitiativeProjectsresultSchema,
  project51fea9Schema,
} from '@/tools/plane/schemas'
import type {
  PlaneManageInitiativeProjectsParams,
  PlaneManageInitiativeProjectsResponse,
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

export const planeManageInitiativeProjectsTool: ToolConfig<
  PlaneManageInitiativeProjectsParams,
  PlaneManageInitiativeProjectsResponse
> = {
  id: 'plane_manage_initiative_projects',
  name: 'Plane Add or remove initiative projects',
  description: 'Add or remove initiative projects in Plane. Supports API v1 compatibility.',
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
      description: 'The initiative project id.',
    },
    add: { type: 'json', required: false, visibility: 'user-or-llm', description: 'The add.' },
    remove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The remove.',
    },
    project_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Project ids.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['pk', 'workspace_slug', 'project_ids']
          : ['workspace_slug', 'pk', 'add', 'remove'],
        ['workspace_slug', 'pk', 'add', 'remove', 'project_ids'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/${safeUrlPathSegment(params.pk, 'pk')}/projects/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/initiatives/${safeUrlPathSegment(params.pk, 'pk')}/projects/`
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            { project_ids: { key: 'project_ids', type: 'array', required: false } },
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
      ? planeListResponse(response, project51fea9Schema, false, false)
      : planeObjectResponse(response, planeV2V2ManageInitiativeProjectsresultSchema),
  outputs: {
    result: PLANEV2V2MANAGEINITIATIVEPROJECTSRESULT_OUTPUT,
    results: {
      type: 'array',
      optional: true,
      description: 'Returned Plane records.',
      items: {
        type: PROJECT51FEA9_OUTPUT.type,
        description: PROJECT51FEA9_OUTPUT.description,
        properties: PROJECT51FEA9_OUTPUT.properties,
      },
    },
    detail: {
      type: 'string',
      optional: true,
      description: 'Provider message when no records are returned.',
    },
  },
}
