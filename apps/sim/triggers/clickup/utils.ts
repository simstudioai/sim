import type { TriggerOutput } from '@/triggers/types'

export const clickupTriggerOptions = [
  { label: 'Task Created', id: 'clickup_task_created' },
  { label: 'Task Updated', id: 'clickup_task_updated' },
  { label: 'Task Deleted', id: 'clickup_task_deleted' },
  { label: 'Task Status Updated', id: 'clickup_task_status_updated' },
  { label: 'Task Priority Updated', id: 'clickup_task_priority_updated' },
  { label: 'Task Assignee Updated', id: 'clickup_task_assignee_updated' },
  { label: 'Task Due Date Updated', id: 'clickup_task_due_date_updated' },
  { label: 'Task Tag Updated', id: 'clickup_task_tag_updated' },
  { label: 'Task Moved', id: 'clickup_task_moved' },
  { label: 'Task Comment Posted', id: 'clickup_task_comment_posted' },
  { label: 'Task Comment Updated', id: 'clickup_task_comment_updated' },
  { label: 'Task Time Estimate Updated', id: 'clickup_task_time_estimate_updated' },
  { label: 'Task Time Tracked Updated', id: 'clickup_task_time_tracked_updated' },
  { label: 'List Created', id: 'clickup_list_created' },
  { label: 'List Updated', id: 'clickup_list_updated' },
  { label: 'List Deleted', id: 'clickup_list_deleted' },
  { label: 'Folder Created', id: 'clickup_folder_created' },
  { label: 'Folder Updated', id: 'clickup_folder_updated' },
  { label: 'Folder Deleted', id: 'clickup_folder_deleted' },
  { label: 'Space Created', id: 'clickup_space_created' },
  { label: 'Space Updated', id: 'clickup_space_updated' },
  { label: 'Space Deleted', id: 'clickup_space_deleted' },
  { label: 'Goal Created', id: 'clickup_goal_created' },
  { label: 'Goal Updated', id: 'clickup_goal_updated' },
  { label: 'Goal Deleted', id: 'clickup_goal_deleted' },
  { label: 'Key Result Created', id: 'clickup_key_result_created' },
  { label: 'Key Result Updated', id: 'clickup_key_result_updated' },
  { label: 'Key Result Deleted', id: 'clickup_key_result_deleted' },
  { label: 'All Events (Generic Webhook)', id: 'clickup_webhook' },
]

/**
 * Builds the setup instructions shown in the trigger configuration panel.
 * ClickUp webhooks are fully managed by Sim: created on deploy, deleted on
 * undeploy, and verified via the per-webhook HMAC secret.
 */
export function clickupSetupInstructions(): string {
  const instructions = [
    '<strong>Note:</strong> Webhooks are automatically created in ClickUp when you deploy this workflow, and deleted when you undeploy. See the <a href="https://developer.clickup.com/docs/webhooks" target="_blank" rel="noopener noreferrer">ClickUp webhook documentation</a> for details.',
    'Connect your <strong>ClickUp account</strong> using the credential selector above.',
    'Select the <strong>Workspace</strong> the webhook should be registered in.',
    'Optionally scope the webhook to a specific space, folder, list, or task.',
    '<strong>Deploy</strong> the workflow — a webhook will be created automatically in your ClickUp workspace.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Maps Sim trigger IDs to the exact ClickUp webhook event names.
 * The catch-all `clickup_webhook` trigger is handled separately (it
 * subscribes with the `*` wildcard).
 */
export const CLICKUP_TRIGGER_EVENT_MAP: Record<string, string[]> = {
  clickup_task_created: ['taskCreated'],
  clickup_task_updated: ['taskUpdated'],
  clickup_task_deleted: ['taskDeleted'],
  clickup_task_status_updated: ['taskStatusUpdated'],
  clickup_task_priority_updated: ['taskPriorityUpdated'],
  clickup_task_assignee_updated: ['taskAssigneeUpdated'],
  clickup_task_due_date_updated: ['taskDueDateUpdated'],
  clickup_task_tag_updated: ['taskTagUpdated'],
  clickup_task_moved: ['taskMoved'],
  clickup_task_comment_posted: ['taskCommentPosted'],
  clickup_task_comment_updated: ['taskCommentUpdated'],
  clickup_task_time_estimate_updated: ['taskTimeEstimateUpdated'],
  clickup_task_time_tracked_updated: ['taskTimeTrackedUpdated'],
  clickup_list_created: ['listCreated'],
  clickup_list_updated: ['listUpdated'],
  clickup_list_deleted: ['listDeleted'],
  clickup_folder_created: ['folderCreated'],
  clickup_folder_updated: ['folderUpdated'],
  clickup_folder_deleted: ['folderDeleted'],
  clickup_space_created: ['spaceCreated'],
  clickup_space_updated: ['spaceUpdated'],
  clickup_space_deleted: ['spaceDeleted'],
  clickup_goal_created: ['goalCreated'],
  clickup_goal_updated: ['goalUpdated'],
  clickup_goal_deleted: ['goalDeleted'],
  clickup_key_result_created: ['keyResultCreated'],
  clickup_key_result_updated: ['keyResultUpdated'],
  clickup_key_result_deleted: ['keyResultDeleted'],
}

/**
 * Extracts the event name from a ClickUp webhook payload.
 * ClickUp payloads are flat: `{ event, webhook_id, task_id | list_id | ..., history_items }`.
 */
export function getClickUpEventType(body: Record<string, unknown>): string | undefined {
  return typeof body.event === 'string' ? body.event : undefined
}

/**
 * Checks whether a ClickUp webhook payload matches a trigger.
 */
export function isClickUpEventMatch(triggerId: string, body: Record<string, unknown>): boolean {
  if (triggerId === 'clickup_webhook') {
    return true
  }

  const eventType = getClickUpEventType(body)
  if (!eventType) {
    return false
  }

  const acceptedEvents = CLICKUP_TRIGGER_EVENT_MAP[triggerId]
  return acceptedEvents ? acceptedEvents.includes(eventType) : false
}

function buildBaseOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'The ClickUp event name (e.g. taskCreated)' },
    historyItems: {
      type: 'json',
      description:
        'History items describing what changed (id, type, date, source, user, before, after)',
    },
    payload: { type: 'json', description: 'Full raw ClickUp webhook payload' },
  }
}

/** Outputs for task-family triggers (task, comment, time events). */
export function buildClickUpTaskOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    taskId: { type: 'string', description: 'ID of the affected task' },
  }
}

/** Outputs for list triggers. */
export function buildClickUpListOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    listId: { type: 'string', description: 'ID of the affected list' },
  }
}

/** Outputs for folder triggers. */
export function buildClickUpFolderOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    folderId: { type: 'string', description: 'ID of the affected folder' },
  }
}

/** Outputs for space triggers. */
export function buildClickUpSpaceOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    spaceId: { type: 'string', description: 'ID of the affected space' },
  }
}

/**
 * Outputs for goal and key result triggers. ClickUp does not document a
 * dedicated resource-ID field for these payloads, so only the documented
 * common fields are exposed; the full body is available via `payload`.
 */
export function buildClickUpGoalOutputs(): Record<string, TriggerOutput> {
  return buildBaseOutputs()
}

/** Outputs for the generic catch-all webhook trigger. */
export function buildClickUpGenericOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    taskId: { type: 'string', description: 'ID of the affected task (task events only)' },
    listId: { type: 'string', description: 'ID of the affected list (list events only)' },
    folderId: { type: 'string', description: 'ID of the affected folder (folder events only)' },
    spaceId: { type: 'string', description: 'ID of the affected space (space events only)' },
  }
}

function extractBaseFields(body: Record<string, unknown>): Record<string, unknown> {
  return {
    eventType: body.event ?? null,
    historyItems: Array.isArray(body.history_items) ? body.history_items : [],
    payload: body,
  }
}

/** Extracts formatted data from a ClickUp task-family event payload. */
export function extractClickUpTaskData(body: Record<string, unknown>): Record<string, unknown> {
  const base = extractBaseFields(body)
  return {
    eventType: base.eventType,
    taskId: body.task_id ?? null,
    historyItems: base.historyItems,
    payload: base.payload,
  }
}

/** Extracts formatted data from a ClickUp list event payload. */
export function extractClickUpListData(body: Record<string, unknown>): Record<string, unknown> {
  const base = extractBaseFields(body)
  return {
    eventType: base.eventType,
    listId: body.list_id ?? null,
    historyItems: base.historyItems,
    payload: base.payload,
  }
}

/** Extracts formatted data from a ClickUp folder event payload. */
export function extractClickUpFolderData(body: Record<string, unknown>): Record<string, unknown> {
  const base = extractBaseFields(body)
  return {
    eventType: base.eventType,
    folderId: body.folder_id ?? null,
    historyItems: base.historyItems,
    payload: base.payload,
  }
}

/** Extracts formatted data from a ClickUp space event payload. */
export function extractClickUpSpaceData(body: Record<string, unknown>): Record<string, unknown> {
  const base = extractBaseFields(body)
  return {
    eventType: base.eventType,
    spaceId: body.space_id ?? null,
    historyItems: base.historyItems,
    payload: base.payload,
  }
}

/** Extracts formatted data from a ClickUp goal or key result event payload. */
export function extractClickUpGoalData(body: Record<string, unknown>): Record<string, unknown> {
  return extractBaseFields(body)
}

/** Extracts formatted data from any ClickUp event payload (catch-all trigger). */
export function extractClickUpGenericData(body: Record<string, unknown>): Record<string, unknown> {
  const base = extractBaseFields(body)
  return {
    eventType: base.eventType,
    taskId: body.task_id ?? null,
    listId: body.list_id ?? null,
    folderId: body.folder_id ?? null,
    spaceId: body.space_id ?? null,
    historyItems: base.historyItems,
    payload: base.payload,
  }
}
