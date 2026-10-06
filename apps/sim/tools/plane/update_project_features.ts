import { PLANEV2V2UPDATEPROJECTFEATURESRESULT8240B7_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2UpdateProjectFeaturesresult8240b7Schema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateProjectFeaturesParams,
  PlaneUpdateProjectFeaturesResponse,
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

export const planeUpdateProjectFeaturesTool: ToolConfig<
  PlaneUpdateProjectFeaturesParams,
  PlaneUpdateProjectFeaturesResponse
> = {
  id: 'plane_update_project_features',
  name: 'Plane Update project features',
  description: 'Update project features in Plane. Supports API v1 compatibility.',
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
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    is_automated_cycle_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is automated cycle enabled.',
    },
    is_epic_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is epic enabled.',
    },
    is_manually_start_end_cycles_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is manually start end cycles enabled.',
    },
    is_milestone_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is milestone enabled.',
    },
    is_parallel_cycles_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is parallel cycles enabled.',
    },
    is_project_updates_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is project updates enabled.',
    },
    is_workflow_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is workflow enabled.',
    },
    epics: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Epics.',
    },
    modules: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Modules.',
    },
    cycles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Cycles.',
    },
    views: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Views.',
    },
    pages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Pages.',
    },
    intakes: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Intakes.',
    },
    work_item_types: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Work item types.',
    },
    workflows: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Workflows',
    },
    parallel_cycles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Parallel cycles',
    },
    project_updates: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Project updates',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? [
              'project_id',
              'workspace_slug',
              'epics',
              'modules',
              'cycles',
              'views',
              'pages',
              'intakes',
              'work_item_types',
              'workflows',
              'parallel_cycles',
              'project_updates',
            ]
          : [
              'workspace_slug',
              'project_id',
              'is_automated_cycle_enabled',
              'is_epic_enabled',
              'is_manually_start_end_cycles_enabled',
              'is_milestone_enabled',
              'is_parallel_cycles_enabled',
              'is_project_updates_enabled',
              'is_workflow_enabled',
            ],
        [
          'workspace_slug',
          'project_id',
          'is_automated_cycle_enabled',
          'is_epic_enabled',
          'is_manually_start_end_cycles_enabled',
          'is_milestone_enabled',
          'is_parallel_cycles_enabled',
          'is_project_updates_enabled',
          'is_workflow_enabled',
          'epics',
          'modules',
          'cycles',
          'views',
          'pages',
          'intakes',
          'work_item_types',
          'workflows',
          'parallel_cycles',
          'project_updates',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/features/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/features/`
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
              epics: { key: 'epics', type: 'boolean', required: false },
              modules: { key: 'modules', type: 'boolean', required: false },
              cycles: { key: 'cycles', type: 'boolean', required: false },
              views: { key: 'views', type: 'boolean', required: false },
              pages: { key: 'pages', type: 'boolean', required: false },
              intakes: { key: 'intakes', type: 'boolean', required: false },
              work_item_types: { key: 'work_item_types', type: 'boolean', required: false },
              workflows: { key: 'workflows', type: 'boolean', required: false },
              parallel_cycles: { key: 'parallel_cycles', type: 'boolean', required: false },
              project_updates: { key: 'project_updates', type: 'boolean', required: false },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              is_automated_cycle_enabled: {
                key: 'is_automated_cycle_enabled',
                type: 'boolean',
                required: false,
              },
              is_epic_enabled: { key: 'is_epic_enabled', type: 'boolean', required: false },
              is_manually_start_end_cycles_enabled: {
                key: 'is_manually_start_end_cycles_enabled',
                type: 'boolean',
                required: false,
              },
              is_milestone_enabled: {
                key: 'is_milestone_enabled',
                type: 'boolean',
                required: false,
              },
              is_parallel_cycles_enabled: {
                key: 'is_parallel_cycles_enabled',
                type: 'boolean',
                required: false,
              },
              is_project_updates_enabled: {
                key: 'is_project_updates_enabled',
                type: 'boolean',
                required: false,
              },
              is_workflow_enabled: { key: 'is_workflow_enabled', type: 'boolean', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2V2UpdateProjectFeaturesresult8240b7Schema)
      : planeObjectResponse(response, planeV2V2UpdateProjectFeaturesresult8240b7Schema),
  outputs: { result: PLANEV2V2UPDATEPROJECTFEATURESRESULT8240B7_OUTPUT },
}
