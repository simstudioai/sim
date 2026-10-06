import type {
  PlaneSetProjectAutomationStatusParams,
  PlaneSetProjectAutomationStatusResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  PLANE_VERSION_PARAM,
  planeApiUrl,
  planeApiVersion,
  planeHeaders,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeSetProjectAutomationStatusTool: ToolConfig<
  PlaneSetProjectAutomationStatusParams,
  PlaneSetProjectAutomationStatusResponse
> = {
  id: 'plane_set_project_automation_status',
  name: 'Plane Enable or disable a project project automation',
  description: 'Enable or disable a project project automation in Plane. Requires API v2.',
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
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project automation id.',
    },
    is_enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the rule is switched on.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/automations/${safeUrlPathSegment(params.pk, 'pk')}/status/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        { is_enabled: { key: 'is_enabled', type: 'boolean', required: true } },
        params.bodyOverrides
      ),
  },
  transformResponse: async () => ({ success: true, output: { success: true } }),
  outputs: { success: { type: 'boolean', description: 'Operation completed successfully.' } },
}
