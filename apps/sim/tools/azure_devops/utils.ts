import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type { AzureDevOpsComment, AzureDevOpsWorkItem } from '@/tools/azure_devops/types'
import type { OutputProperty } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * The `https://dev.azure.com/<organization>/<project>` prefix every project-scoped
 * request is built on. Each segment is traversal-safe, so a project or id can never
 * climb into another organization's endpoints with the caller's token.
 */
export function azureDevOpsProjectUrl(params: { organization: string; project: string }): string {
  return `https://dev.azure.com/${pathSegment(params.organization, 'organization')}/${pathSegment(params.project, 'project')}`
}

/** A name copied from the browser's address bar arrives encoded; decode it once so it isn't encoded twice. */
function pathSegment(value: string, paramName: string): string {
  const typed = value.trim()
  let decoded = typed
  try {
    decoded = decodeURIComponent(typed)
  } catch {}
  return safeUrlPathSegment(decoded, paramName)
}

/** Work Items - List accepts at most 200 ids per request. */
export const WORK_ITEMS_BATCH_SIZE = 200

/**
 * Fetches one Work Items - List chunk with `$expand=all`, bounded to the inline
 * tool response size and cancelled with the tool call.
 */
export async function fetchWorkItemsChunk(
  params: { organization: string; project: string; accessToken: string },
  ids: Array<string | number>,
  errorPrefix: string,
  signal?: AbortSignal
): Promise<AzureDevOpsWorkItem[]> {
  const url = new URL(`${azureDevOpsProjectUrl(params)}/_apis/wit/workitems`)
  url.searchParams.set('ids', ids.join(','))
  url.searchParams.set('$expand', 'all')
  url.searchParams.set('api-version', '7.2-preview.3')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    },
    signal,
  })

  if (!response.ok) {
    const errorBody = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Azure DevOps work items error body',
      signal,
    }).catch(() => '')
    throw new Error(`${errorPrefix} (${response.status}): ${errorBody || response.statusText}`)
  }

  const data = await readResponseJsonWithLimit<{ value?: AzureDevOpsRawWorkItem[] }>(response, {
    maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
    label: 'Azure DevOps work items response',
    signal,
  })
  return (data.value ?? []).map(mapWorkItem)
}

/** States for Azure DevOps Basic process work items (Issue, Task, Epic). */
export const AZURE_DEVOPS_BASIC_WORK_ITEM_STATES = ['To Do', 'Doing', 'Done'] as const

export type AzureDevOpsJsonPatchOp = {
  op: string
  path: string
  value: string | number
}

/**
 * Appends a JSON-Patch op for a single work item field when the value is non-empty.
 * Skips silently on undefined/empty-string. Numbers are validated; strings are
 * passed through.
 */
export function appendFieldPatchOp(
  ops: AzureDevOpsJsonPatchOp[],
  refName: string,
  value: string | number | undefined,
  patchOp: 'add' | 'replace',
  kind: 'number' | 'string'
): void {
  if (value === undefined || value === '') return
  if (kind === 'number') {
    const numeric = Number(value)
    if (Number.isNaN(numeric)) return
    ops.push({ op: patchOp, path: `/fields/${refName}`, value: numeric })
    return
  }
  ops.push({ op: patchOp, path: `/fields/${refName}`, value: String(value) })
}

/**
 * Appends a Microsoft.VSTS.Scheduling.Effort patch when effort is a valid number.
 * Field availability depends on work item type and process template (Issue in Basic).
 */
export function appendEffortPatchOp(
  ops: AzureDevOpsJsonPatchOp[],
  effort: number | string | undefined,
  patchOp: 'add' | 'replace'
): void {
  appendFieldPatchOp(ops, 'Microsoft.VSTS.Scheduling.Effort', effort, patchOp, 'number')
}

export function mapWorkItem(raw: AzureDevOpsRawWorkItem): AzureDevOpsWorkItem {
  const fields = raw.fields ?? {}
  const assignedTo = identityField(fields['System.AssignedTo'])
  const priority = fields['Microsoft.VSTS.Common.Priority']
  return {
    id: raw.id,
    title: (fields['System.Title'] as string | undefined) ?? '',
    state: (fields['System.State'] as string | undefined) ?? '',
    workItemType: (fields['System.WorkItemType'] as string | undefined) ?? '',
    assignedTo: assignedTo?.displayName ?? null,
    areaPath: (fields['System.AreaPath'] as string | undefined) ?? '',
    url: raw.url,
    rev: raw.rev ?? null,
    description: stringField(fields['System.Description']),
    iterationPath: stringField(fields['System.IterationPath']),
    reason: stringField(fields['System.Reason']),
    tags: stringField(fields['System.Tags']),
    priority: typeof priority === 'number' ? priority : null,
    assignedToUniqueName: assignedTo?.uniqueName ?? null,
    createdBy: identityField(fields['System.CreatedBy'])?.displayName ?? null,
    createdDate: stringField(fields['System.CreatedDate']),
    changedBy: identityField(fields['System.ChangedBy'])?.displayName ?? null,
    changedDate: stringField(fields['System.ChangedDate']),
    webUrl: raw._links?.html?.href ?? null,
    relations: (raw.relations ?? []).map((relation) => ({
      rel: relation.rel,
      url: relation.url,
      attributes: relation.attributes ?? {},
    })),
    fields,
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function identityField(value: unknown): AzureDevOpsIdentityRef | null {
  return value && typeof value === 'object' ? (value as AzureDevOpsIdentityRef) : null
}

/** Output schema for the work item fields beyond the original summary set. */
export const WORK_ITEM_DETAIL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  rev: { type: 'number', description: 'Revision number of the work item', optional: true },
  description: {
    type: 'string',
    description: 'Description (System.Description, HTML)',
    optional: true,
    nullable: true,
  },
  iterationPath: {
    type: 'string',
    description: 'Iteration path (System.IterationPath)',
    optional: true,
    nullable: true,
  },
  reason: {
    type: 'string',
    description: 'Reason for the current state (System.Reason)',
    optional: true,
    nullable: true,
  },
  tags: {
    type: 'string',
    description: 'Semicolon-separated tags (System.Tags)',
    optional: true,
    nullable: true,
  },
  priority: {
    type: 'number',
    description: 'Priority (Microsoft.VSTS.Common.Priority)',
    optional: true,
    nullable: true,
  },
  assignedToUniqueName: {
    type: 'string',
    description: 'Unique name (usually the email) of the assigned user',
    optional: true,
    nullable: true,
  },
  createdBy: {
    type: 'string',
    description: 'Display name of the creator',
    optional: true,
    nullable: true,
  },
  createdDate: {
    type: 'string',
    description: 'ISO 8601 creation timestamp',
    optional: true,
    nullable: true,
  },
  changedBy: {
    type: 'string',
    description: 'Display name of the last user to change the work item',
    optional: true,
    nullable: true,
  },
  changedDate: {
    type: 'string',
    description: 'ISO 8601 last-changed timestamp',
    optional: true,
    nullable: true,
  },
  webUrl: {
    type: 'string',
    description: 'Browser URL for the work item',
    optional: true,
    nullable: true,
  },
  relations: {
    type: 'array',
    description:
      'Links to other work items, attachments, and artifacts (rel such as System.LinkTypes.Hierarchy-Forward or AttachedFile, url, attributes)',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: { type: 'string', description: 'Relation type' },
        url: { type: 'string', description: 'URL of the linked resource' },
        attributes: { type: 'json', description: 'Link attributes (name, comment, isLocked)' },
      },
    },
  },
  fields: {
    type: 'json',
    description:
      'Every field returned for the work item, keyed by reference name (includes custom and process-specific fields)',
    optional: true,
  },
}

export function formatWorkItem(w: AzureDevOpsWorkItem): string {
  return [
    `ID: ${w.id}  [${w.workItemType}] ${w.title}`,
    `  State: ${w.state}`,
    `  Assigned To: ${w.assignedTo ?? 'Unassigned'}`,
    `  Area: ${w.areaPath}`,
  ].join('\n')
}

export interface AzureDevOpsRawWorkItem {
  id: number
  rev?: number
  url: string
  fields: Record<string, unknown>
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>
  _links?: { html?: { href?: string } }
}

export function mapComment(raw: AzureDevOpsRawComment): AzureDevOpsComment {
  return {
    workItemId: raw.workItemId,
    commentId: raw.commentId ?? raw.id,
    version: raw.version,
    text: raw.text,
    renderedText: raw.renderedText,
    createdBy: raw.createdBy?.displayName ?? null,
    createdDate: raw.createdDate,
    modifiedBy: raw.modifiedBy?.displayName ?? null,
    modifiedDate: raw.modifiedDate,
    isDeleted: raw.isDeleted ?? false,
    url: raw.url,
  }
}

export function formatComment(comment: AzureDevOpsComment): string {
  return [
    `Comment #${comment.commentId} on work item #${comment.workItemId}`,
    `  Author: ${comment.createdBy ?? 'Unknown'}`,
    `  Created: ${comment.createdDate}`,
    `  Text: ${comment.text}`,
  ].join('\n')
}

interface AzureDevOpsIdentityRef {
  displayName?: string
  uniqueName?: string
}

export interface AzureDevOpsRawComment {
  id: number
  commentId?: number
  workItemId: number
  version: number
  text: string
  renderedText?: string
  createdBy?: AzureDevOpsIdentityRef
  createdDate: string
  modifiedBy?: AzureDevOpsIdentityRef
  modifiedDate: string
  isDeleted?: boolean
  url: string
}
