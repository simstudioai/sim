import type { AzureDevOpsComment, AzureDevOpsWorkItem } from '@/tools/azure_devops/types'

/** States for Azure DevOps Basic process work items (Issue, Task, Epic). */
export const AZURE_DEVOPS_BASIC_WORK_ITEM_STATES = ['To Do', 'Doing', 'Done'] as const

/** Work item types for Azure DevOps Basic process. */
export const AZURE_DEVOPS_BASIC_WORK_ITEM_TYPES = ['Issue', 'Task', 'Epic'] as const

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
  return {
    id: raw.id,
    title: (fields['System.Title'] as string | undefined) ?? '',
    state: (fields['System.State'] as string | undefined) ?? '',
    workItemType: (fields['System.WorkItemType'] as string | undefined) ?? '',
    assignedTo:
      (fields['System.AssignedTo'] as { displayName?: string } | undefined)?.displayName ?? null,
    areaPath: (fields['System.AreaPath'] as string | undefined) ?? '',
    url: raw.url,
  }
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
  url: string
  fields: Record<string, unknown>
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
