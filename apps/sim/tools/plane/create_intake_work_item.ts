import { PLANEV2INTAKEWORKITEMSD605CE_OUTPUT } from '@/tools/plane/outputs'
import { planeV2IntakeWorkItemsd605ceSchema } from '@/tools/plane/schemas'
import type {
  PlaneCreateIntakeWorkItemParams,
  PlaneCreateIntakeWorkItemResponse,
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

export const planeCreateIntakeWorkItemTool: ToolConfig<
  PlaneCreateIntakeWorkItemParams,
  PlaneCreateIntakeWorkItemResponse
> = {
  id: 'plane_create_intake_work_item',
  name: 'Plane Create an intake work item',
  description: 'Create an intake work item in Plane. Supports API v1 compatibility.',
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
    description_html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rich-text body as HTML. This is the field the Plane editor round-trips.',
    },
    duplicate_to_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Id of the related duplicate to. Nullable.',
    },
    external_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Your system's identifier for this record, for sync and import correlation. Nullable.",
    },
    external_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The system `external_id` came from, for example `github` or `jira`. Nullable.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name.',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '- `none` - none - `low` - low - `medium` - medium - `high` - high - `urgent` - urgent One of `none`, `low`, `medium`, `high`, `urgent`.',
    },
    snoozed_till: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The snoozed till. Nullable.',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The source.',
    },
    source_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The source email. Nullable.',
    },
    status: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The status.',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return. Unrequested keys are **omitted**, not returned as `null`. `id` always comes back. Pass `all` for every requestable field. An unknown name is a `400`. See [Sparse fields](/api-reference/v2/sparse-fields). Requestable here: `created_at`, `created_by_id`, `description_html`, `duplicate_to_id`, `external_id`, `external_source`, `id`, `intake_id`, `name`, `priority`, `snoozed_till`, `source`, `source_email`, `state_id`, `status`, `work_item_id`.',
    },
    issue: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'v1 compatibility only. Issue data for the intake issue',
    },
  },
  request: {
    url: (params) => {
      const version = planeApiVersion(params.apiVersion, true)
      assertPlaneVersionFields(
        params,
        version === 'v1'
          ? ['project_id', 'workspace_slug', 'issue']
          : [
              'workspace_slug',
              'project_id',
              'description_html',
              'duplicate_to_id',
              'external_id',
              'external_source',
              'name',
              'priority',
              'snoozed_till',
              'source',
              'source_email',
              'status',
              'fields',
            ],
        [
          'workspace_slug',
          'project_id',
          'description_html',
          'duplicate_to_id',
          'external_id',
          'external_source',
          'name',
          'priority',
          'snoozed_till',
          'source',
          'source_email',
          'status',
          'fields',
          'issue',
        ],
        version
      )
      return version === 'v1'
        ? planeApiUrl(
            params.baseUrl,
            `/api/v1/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/intake-issues/`
          )
        : planeApiUrl(
            params.baseUrl,
            `/api/v2/workspaces/${safeUrlPathSegment(params.workspace_slug, 'workspace_slug')}/projects/${safeUrlPathSegment(params.project_id, 'project_id')}/intake-issues/`,
            planeVersionedValues(params, {
              fields: { key: 'fields', type: 'string', required: false },
            })
          )
    },
    method: 'POST',
    headers: (params) => planeHeaders(params.apiKey),
    redirectPolicy: planeRedirectPolicy,
    body: (params) =>
      planeApiVersion(params.apiVersion, true) === 'v1'
        ? planeVersionedValues(
            params,
            { issue: { key: 'issue', type: 'object', required: true } },
            params.bodyOverrides
          )
        : planeVersionedValues(
            params,
            {
              description_html: { key: 'description_html', type: 'string', required: false },
              duplicate_to_id: { key: 'duplicate_to_id', type: 'string', required: false },
              external_id: { key: 'external_id', type: 'string', required: false },
              external_source: { key: 'external_source', type: 'string', required: false },
              name: { key: 'name', type: 'string', required: false },
              priority: { key: 'priority', type: 'string', required: false },
              snoozed_till: { key: 'snoozed_till', type: 'string', required: false },
              source: { key: 'source', type: 'string', required: false },
              source_email: { key: 'source_email', type: 'string', required: false },
              status: { key: 'status', type: 'integer', required: false },
            },
            params.bodyOverrides
          ),
  },
  transformResponse: async (response, params) =>
    planeApiVersion(params?.apiVersion, true) === 'v1'
      ? planeObjectResponse(response, planeV2IntakeWorkItemsd605ceSchema)
      : planeObjectResponse(response, planeV2IntakeWorkItemsd605ceSchema),
  outputs: { result: PLANEV2INTAKEWORKITEMSD605CE_OUTPUT },
}
