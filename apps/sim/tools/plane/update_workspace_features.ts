import { PLANEV2WORKSPACEFEATURES56CADD_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkspaceFeatures56caddSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateWorkspaceFeaturesParams,
  PlaneUpdateWorkspaceFeaturesResponse,
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

export const planeUpdateWorkspaceFeaturesTool: ToolConfig<
  PlaneUpdateWorkspaceFeaturesParams,
  PlaneUpdateWorkspaceFeaturesResponse
> = {
  id: 'plane_update_workspace_features',
  name: 'Plane Update workspace features',
  description: 'Update workspace features in Plane. Supports API v1 compatibility.',
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
    is_work_item_types_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Manage work item types at the workspace level (`true`) or per project (`false`). This is the work item type mode switch — read [Work item type modes](/api-reference/v2/work-item-type-modes) before changing it.',
    },
    work_item_type_default_level: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The default level applied to work item types in this workspace. The schema declares no enum and no bounds, so it accepts any integer.',
    },
    is_workitem_hierarchy_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Allow work items to be nested into a parent and child hierarchy. Note the spelling — no underscore between `work` and `item`.',
    },
    is_project_grouping_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow projects to be organized into groups in the workspace.',
    },
    is_teams_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable teamspaces for the workspace.',
    },
    is_wiki_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable the workspace-level wiki.',
    },
    is_initiative_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Enable initiatives, the layer that groups projects and epics toward a larger outcome.',
    },
    is_customer_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable customers and customer requests.',
    },
    is_release_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable releases.',
    },
    is_state_duration_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record how long work items spend in each state.',
    },
    is_pi_enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Enable Pi, Plane's AI assistant, in the workspace.",
    },
    project_grouping: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Project grouping.',
    },
    initiatives: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Initiatives.',
    },
    teams: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Teams.',
    },
    customers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Customers.',
    },
    wiki: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Wiki.',
    },
    pi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Pi.',
    },
    work_item_types: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Work item types',
    },
    releases: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Releases',
    },
    states_owned_by_workspace: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. States owned by workspace',
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
              'project_grouping',
              'initiatives',
              'teams',
              'customers',
              'wiki',
              'pi',
              'work_item_types',
              'releases',
              'states_owned_by_workspace',
            ]
          : [
              'workspace_slug',
              'is_work_item_types_enabled',
              'work_item_type_default_level',
              'is_workitem_hierarchy_enabled',
              'is_project_grouping_enabled',
              'is_teams_enabled',
              'is_wiki_enabled',
              'is_initiative_enabled',
              'is_customer_enabled',
              'is_release_enabled',
              'is_state_duration_enabled',
              'is_pi_enabled',
            ],
        [
          'workspace_slug',
          'is_work_item_types_enabled',
          'work_item_type_default_level',
          'is_workitem_hierarchy_enabled',
          'is_project_grouping_enabled',
          'is_teams_enabled',
          'is_wiki_enabled',
          'is_initiative_enabled',
          'is_customer_enabled',
          'is_release_enabled',
          'is_state_duration_enabled',
          'is_pi_enabled',
          'project_grouping',
          'initiatives',
          'teams',
          'customers',
          'wiki',
          'pi',
          'work_item_types',
          'releases',
          'states_owned_by_workspace',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/features/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/features/`
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
              project_grouping: { key: 'project_grouping', type: 'boolean', required: false },
              initiatives: { key: 'initiatives', type: 'boolean', required: false },
              teams: { key: 'teams', type: 'boolean', required: false },
              customers: { key: 'customers', type: 'boolean', required: false },
              wiki: { key: 'wiki', type: 'boolean', required: false },
              pi: { key: 'pi', type: 'boolean', required: false },
              work_item_types: { key: 'work_item_types', type: 'boolean', required: false },
              releases: { key: 'releases', type: 'boolean', required: false },
              states_owned_by_workspace: {
                key: 'states_owned_by_workspace',
                type: 'boolean',
                required: false,
              },
            },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              is_work_item_types_enabled: {
                key: 'is_work_item_types_enabled',
                type: 'boolean',
                required: false,
              },
              work_item_type_default_level: {
                key: 'work_item_type_default_level',
                type: 'integer',
                required: false,
              },
              is_workitem_hierarchy_enabled: {
                key: 'is_workitem_hierarchy_enabled',
                type: 'boolean',
                required: false,
              },
              is_project_grouping_enabled: {
                key: 'is_project_grouping_enabled',
                type: 'boolean',
                required: false,
              },
              is_teams_enabled: { key: 'is_teams_enabled', type: 'boolean', required: false },
              is_wiki_enabled: { key: 'is_wiki_enabled', type: 'boolean', required: false },
              is_initiative_enabled: {
                key: 'is_initiative_enabled',
                type: 'boolean',
                required: false,
              },
              is_customer_enabled: { key: 'is_customer_enabled', type: 'boolean', required: false },
              is_release_enabled: { key: 'is_release_enabled', type: 'boolean', required: false },
              is_state_duration_enabled: {
                key: 'is_state_duration_enabled',
                type: 'boolean',
                required: false,
              },
              is_pi_enabled: { key: 'is_pi_enabled', type: 'boolean', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2WorkspaceFeatures56caddSchema)
      : planeObjectResponse(response, planeV2WorkspaceFeatures56caddSchema),
  outputs: { result: PLANEV2WORKSPACEFEATURES56CADD_OUTPUT },
}
