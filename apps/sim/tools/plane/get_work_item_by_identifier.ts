import { PLANEV2WORKITEMSE09EEB_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemse09eebSchema } from '@/tools/plane/schemas'
import type {
  PlaneGetWorkItemByIdentifierParams,
  PlaneGetWorkItemByIdentifierResponse,
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

export const planeGetWorkItemByIdentifierTool: ToolConfig<
  PlaneGetWorkItemByIdentifierParams,
  PlaneGetWorkItemByIdentifierResponse
> = {
  id: 'plane_get_work_item_by_identifier',
  name: 'Plane Get a work item by identifier',
  description: 'Get a work item by identifier in Plane. Requires API v2.',
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
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "The work item's human key: the project identifier, a hyphen, and the work item's number — `PROJ-142`. The project part must start with a letter, and it is upper-cased before lookup, so `proj-142` resolves the same work item as `PROJ-142`. A project identifier is unique within a workspace, which is what makes this key unambiguous.",
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Comma-separated relations to embed alongside the ids: `assignees` (the assigned users), `cycle` (the cycle it belongs to), `labels` (the applied labels), `modules` (the modules it belongs to), `parent` (its parent work item), `state` (the work item's state object), `type` (its work item type). Expansion is separate-key: `?expand=state` keeps `state_id` and adds a `state` object next to it, so an id is never replaced by an object. An unknown value is a `400`. `?fields=` and `?expand=` are independent namespaces. Relation names are not valid `?fields=` tokens (and vice versa), and an expanded object survives field filtering — `?fields=id,name&expand=state` returns `id`, `name` and `state`. See [Expanding relations](https://developers.plane.so/api-reference/v2/expanding-relations). Expanded relations appear beside their ID fields and survive sparse field filtering. Use only the relation names listed above.",
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted** from the response, not returned as `null`, so absent means "not requested" and `null` means "actually null". `id` always comes back whether or not you name it. Pass `all` for every requestable field. An unknown name is a `400` that lists the valid set and suggests the closest match, so a typo can\'t silently cost you the saving. Requestable here: `archived_at`, `assignee_ids`, `created_at`, `created_by_id`, `custom_fields`, `cycle_id`, `id`, `identifier`, `is_draft`, `label_ids`, `module_ids`, `name`, `parent_id`, `priority`, `project_id`, `sequence_id`, `start_date`, `state_id`, `target_date`, `type_id`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields).',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/work-items/${safeUrlPathSegment(params.identifier, 'identifier')}/`,
        planeVersionedValues(params, {
          expand: { key: 'expand', type: 'string', required: false },
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
    planeObjectResponse(response, planeV2WorkItemse09eebSchema),
  outputs: { result: PLANEV2WORKITEMSE09EEB_OUTPUT },
}
