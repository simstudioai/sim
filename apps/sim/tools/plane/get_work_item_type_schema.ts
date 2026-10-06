import { PLANEV2V2GETWORKITEMTYPESCHEMARESULT_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2GetWorkItemTypeSchemaresultSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkItemTypeSchemaParams,
  PlaneGetWorkItemTypeSchemaResponse,
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

export const planeGetWorkItemTypeSchemaTool: ToolConfig<
  PlaneGetWorkItemTypeSchemaParams,
  PlaneGetWorkItemTypeSchemaResponse
> = {
  id: 'plane_get_work_item_type_schema',
  name: 'Plane Get a work item type schema',
  description: 'Get a work item type schema in Plane. Requires API v2.',
  version: '1.0.0',
  params: {
    ...PLANE_CREDENTIAL_PARAMS,
    apiVersion: PLANE_VERSION_PARAM,
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
        'The project the type belongs to. The schema is project-specific: states, labels, members, and estimate points all come from this project.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The id of the work item type whose schema you want.',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated extra option lists to inline. Two values are recognized: - `members` — inlines the project's active members as the options for `assignee_ids`, and for any custom property that is a user relation - `labels` — inlines the project's labels as the options for `label_ids` Omit it and those fields still appear, they just describe themselves without an option list. These lists can be large in a big workspace, so ask for them only when you are actually rendering a picker — for example `?include=members,labels`.",
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The standard work item fields, keyed by the body parameter name you would send — `name`, `description_html`, `priority`, `state_id`, `assignee_ids`, `label_ids`, `start_date`, `target_date`, `parent_id`. Each entry carries a `type`, a `required` flag, and where it applies an `is_multi` flag, a `default`, a `max_length`, a `format`, or an `options` array. `state_id` and `priority` always arrive with their options inlined, because those are the two fields a client cannot guess. `estimate_point_id` appears only when the project has an estimate system configured.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-item-types/${safeUrlPathSegment(params.pk, 'pk')}/schema/`,
        planeVersionedValues(params, {
          include: { key: 'include', type: 'string', required: false },
          fields: { key: 'fields', type: 'string', required: false },
        })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2V2GetWorkItemTypeSchemaresultSchema),
  outputs: { result: PLANEV2V2GETWORKITEMTYPESCHEMARESULT_OUTPUT },
}
