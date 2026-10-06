import { PLANECREATEPROJECTWITHTEMPLATERESULTBB886A_OUTPUT } from '@/tools/plane/outputs'
import { planeCreateProjectWithTemplateResultbb886aSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateProjectWithTemplateParams,
  PlaneCreateProjectWithTemplateResponse,
} from '@/tools/plane/types'
import {
  PLANE_CREDENTIAL_PARAMS,
  planeApiUrl,
  planeHeaders,
  planeObjectResponse,
  planeRedirectPolicy,
  planeVersionedValues,
} from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const planeCreateProjectWithTemplateTool: ToolConfig<
  PlaneCreateProjectWithTemplateParams,
  PlaneCreateProjectWithTemplateResponse
> = {
  id: 'plane_create_project_with_template',
  name: 'Plane v1 only: Create project with template',
  description: 'v1 only: Create project with template in Plane. Requires API v1.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the new project. Overrides the template default.',
    },
    identifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Short identifier for the project (e.g. `MAR`). Overrides the template default.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the new project. Overrides the template default.',
    },
    project_lead: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID of the project lead. The lead is added as a project admin. Overrides the template default.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/templates/use/`
      )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          name: { key: 'name', type: 'string', required: false },
          identifier: { key: 'identifier', type: 'string', required: false },
          description: { key: 'description', type: 'string', required: false },
          project_lead: { key: 'project_lead', type: 'string', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeCreateProjectWithTemplateResultbb886aSchema),
  outputs: { result: PLANECREATEPROJECTWITHTEMPLATERESULTBB886A_OUTPUT },
}
