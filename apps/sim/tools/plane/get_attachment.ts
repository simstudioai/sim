import { PLANEV2WORKITEMATTACHMENTSEE0DAD_OUTPUT } from '@/tools/plane/outputs'
import { planeV2WorkItemAttachmentsee0dadSchema } from '@/tools/plane/schemas'
import type { PlaneGetAttachmentParams, PlaneGetAttachmentResponse } from '@/tools/plane/types'
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

export const planeGetAttachmentTool: ToolConfig<
  PlaneGetAttachmentParams,
  PlaneGetAttachmentResponse
> = {
  id: 'plane_get_attachment',
  name: 'Plane Get an attachment',
  description: 'Get an attachment in Plane. Requires API v2.',
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
        'The project the resource belongs to. Accepts the project UUID or its bare identifier, for example `ENG`.',
    },
    work_item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The work item the resource hangs off. Accepts the work item UUID or its `PROJ-123` identifier.',
    },
    pk: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The attachment id.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](https://developers.plane.so/api-reference/v2/sparse-fields). Requestable here: `asset_url`, `attributes`, `content_type`, `created_at`, `created_by_id`, `external_id`, `external_source`, `id`, `is_uploaded`, `name`, `size`, `work_item_id`.',
    },
  },
  request: {
    url: (params) => {
      planeApiVersion(params.apiVersion, false)
      return planeApiUrl(
        params.baseUrl,
        `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/work-items/${safeUrlPathSegment(params.work_item_id, 'work_item_id')}/attachments/${safeUrlPathSegment(params.pk, 'pk')}/`,
        planeVersionedValues(params, { fields: { key: 'fields', type: 'string', required: false } })
      )
    },
    method: 'GET',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: true },
  },
  transformResponse: async (response) =>
    planeObjectResponse(response, planeV2WorkItemAttachmentsee0dadSchema),
  outputs: { result: PLANEV2WORKITEMATTACHMENTSEE0DAD_OUTPUT },
}
