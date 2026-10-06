import { PLANEV2V2TRANSFERCYCLEWORKITEMSRESULTDF206A_OUTPUT } from '@/tools/plane/outputs'
import { planeV2V2TransferCycleWorkItemsresultdf206aSchema } from '@/tools/plane/schemas'
import type {
  PlaneTransferCycleWorkItemsParams,
  PlaneTransferCycleWorkItemsResponse,
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

export const planeTransferCycleWorkItemsTool: ToolConfig<
  PlaneTransferCycleWorkItemsParams,
  PlaneTransferCycleWorkItemsResponse
> = {
  id: 'plane_transfer_cycle_work_items',
  name: 'Plane Transfer work items between cycles',
  description: 'Transfer work items between cycles in Plane. Supports API v1 compatibility.',
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
      description: 'Source cycle ID. The source cycle must be completed.',
    },
    new_cycle_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Id of the related new cycle.',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['pk', 'project_id', 'workspace_slug', 'new_cycle_id']
          : ['workspace_slug', 'project_id', 'pk', 'new_cycle_id'],
        ['workspace_slug', 'project_id', 'pk', 'new_cycle_id'],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/transfer-issues/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/cycles/${safeUrlPathSegment(params.pk, 'pk')}/transfer/`
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            { new_cycle_id: { key: 'new_cycle_id', type: 'string', required: true } },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            { new_cycle_id: { key: 'new_cycle_id', type: 'string', required: true } },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2V2TransferCycleWorkItemsresultdf206aSchema)
      : planeObjectResponse(response, planeV2V2TransferCycleWorkItemsresultdf206aSchema),
  outputs: { result: PLANEV2V2TRANSFERCYCLEWORKITEMSRESULTDF206A_OUTPUT },
}
