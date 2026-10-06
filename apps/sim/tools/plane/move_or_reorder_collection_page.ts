import { COLLECTIONPAGED68582_OUTPUT } from '@/tools/plane/outputs'
import { collectionPaged68582Schema } from '@/tools/plane/schemas'
import type {
  PlaneMoveOrReorderCollectionPageParams,
  PlaneMoveOrReorderCollectionPageResponse,
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

export const planeMoveOrReorderCollectionPageTool: ToolConfig<
  PlaneMoveOrReorderCollectionPageParams,
  PlaneMoveOrReorderCollectionPageResponse
> = {
  id: 'plane_move_or_reorder_collection_page',
  name: 'Plane v1 only: Move or reorder a collection page',
  description: 'v1 only: Move or reorder a collection page in Plane. Requires API v1.',
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
    collection_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The source collection ID.',
    },
    page_collection_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The page membership ID returned as `page_collection_id` by the list endpoint.',
    },
    collection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A destination collection ID. Omit or use the source ID to reorder in place.',
    },
    sort_order: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'An explicit ordering value.',
    },
    placement: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Placement with `type`: `append`, `before`, or `after`; optional `parent_id`; and required `target_page_id` for before/after. Overrides `sort_order`.',
    },
  },
  request: {
    url: (params) => {
      return planeApiUrl(
        params.baseUrl,
        `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/collections/${safeUrlPathSegment(params.collection_id, 'collection_id')}/pages/${safeUrlPathSegment(params.page_collection_id, 'page_collection_id')}/`
      )
    },
    method: 'PATCH',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeVersionedValues(
        params,
        {
          collection: { key: 'collection', type: 'string', required: false },
          sort_order: { key: 'sort_order', type: 'number', required: false },
          placement: { key: 'placement', type: 'object', required: false },
        },
        params.bodyOverrides
      ),
  },
  transformResponse: async (response) => planeObjectResponse(response, collectionPaged68582Schema),
  outputs: { result: COLLECTIONPAGED68582_OUTPUT },
}
