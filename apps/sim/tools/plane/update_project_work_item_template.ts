import { PLANEV2PROJECTWORKITEMTEMPLATES_OUTPUT } from '@/tools/plane/outputs'
import { planeV2ProjectWorkItemTemplatesSchema } from '@/tools/plane/schemas'
import type {
  PlaneUpdateProjectWorkItemTemplateParams,
  PlaneUpdateProjectWorkItemTemplateResponse,
} from '@/tools/plane/types'
import {
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

export const planeUpdateProjectWorkItemTemplateTool: ToolConfig<
  PlaneUpdateProjectWorkItemTemplateParams,
  PlaneUpdateProjectWorkItemTemplateResponse
> = {
  id: 'plane_update_project_work_item_template',
  name: 'Plane Update a project work item template',
  description: 'Update a project work item template in Plane. Requires API v2.',
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
      description: 'The project work item template id.',
    },
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    is_published: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether is published.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name. Maximum 255 characters.',
    },
    short_description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The short description. Nullable.',
    },
    template_data: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seed payload used on create/update and nested under read `template_data`.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description_html`, `id`, `is_published`, `name`, `short_description`, `short_id`, `slug`, `template_data`, `template_type`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-templates/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          description_html: { key: 'description_html', type: 'string', required: false },
          is_published: { key: 'is_published', type: 'boolean', required: false },
          name: { key: 'name', type: 'string', required: false },
          short_description: { key: 'short_description', type: 'string', required: false },
          template_data: { key: 'template_data', type: 'object', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2ProjectWorkItemTemplatesSchema),
  outputs: { result: PLANEV2PROJECTWORKITEMTEMPLATES_OUTPUT },
}
