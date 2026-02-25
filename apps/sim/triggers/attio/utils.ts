import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const attioTriggerOptions = [
  { label: 'Record Created', id: 'attio_record_created' },
  { label: 'Record Updated', id: 'attio_record_updated' },
  { label: 'Record Deleted', id: 'attio_record_deleted' },
  { label: 'Record Merged', id: 'attio_record_merged' },
  { label: 'Note Created', id: 'attio_note_created' },
  { label: 'Note Updated', id: 'attio_note_updated' },
  { label: 'Note Deleted', id: 'attio_note_deleted' },
  { label: 'Task Created', id: 'attio_task_created' },
  { label: 'Task Updated', id: 'attio_task_updated' },
  { label: 'Task Deleted', id: 'attio_task_deleted' },
  { label: 'Comment Created', id: 'attio_comment_created' },
  { label: 'Comment Resolved', id: 'attio_comment_resolved' },
  { label: 'Comment Unresolved', id: 'attio_comment_unresolved' },
  { label: 'Comment Deleted', id: 'attio_comment_deleted' },
  { label: 'List Entry Created', id: 'attio_list_entry_created' },
  { label: 'List Entry Updated', id: 'attio_list_entry_updated' },
  { label: 'List Entry Deleted', id: 'attio_list_entry_deleted' },
  { label: 'Generic Webhook (All Events)', id: 'attio_webhook' },
]

export function attioSetupInstructions(): string {
  const instructions = [
    '<strong>Note:</strong> Webhooks are automatically created in Attio when you deploy this workflow, and deleted when you undeploy. See the <a href="https://docs.attio.com/rest-api/guides/webhooks" target="_blank" rel="noopener noreferrer">Attio webhook documentation</a> for details.',
    'Connect your <strong>Attio account</strong> using the credential selector above.',
    '<strong>Deploy</strong> the workflow — a webhook will be created automatically in your Attio workspace.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Builds subBlocks for an Attio trigger with OAuth credentials and automatic webhook lifecycle.
 * Used by both the primary trigger (with dropdown) and secondary triggers.
 */
export function buildAttioTriggerSubBlocks(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'triggerCredentials',
      title: 'Attio Account',
      type: 'oauth-input',
      serviceId: 'attio',
      mode: 'trigger',
      required: true,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerSave',
      title: 'Save',
      type: 'trigger-save',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: attioSetupInstructions(),
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Base webhook outputs common to all Attio triggers.
 */
function buildBaseWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: {
      type: 'string',
      description: 'The type of event (e.g. record.created, note.created)',
    },
  }
}

/**
 * Record event outputs for record triggers.
 */
function buildRecordIdOutputs(): Record<string, TriggerOutput> {
  return {
    workspaceId: { type: 'string', description: 'The workspace ID' },
    objectId: { type: 'string', description: 'The object type ID (e.g. people, companies)' },
    recordId: { type: 'string', description: 'The record ID' },
  }
}

/**
 * Record updated event outputs (includes attributeId).
 */
function buildRecordUpdatedIdOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildRecordIdOutputs(),
    attributeId: {
      type: 'string',
      description: 'The ID of the attribute that was updated on the record',
    },
  }
}

/**
 * Record merged event outputs.
 * Attio payload: id.record_id (winner), duplicate_object_id, duplicate_record_id (loser).
 */
function buildRecordMergedOutputs(): Record<string, TriggerOutput> {
  return {
    workspaceId: { type: 'string', description: 'The workspace ID' },
    objectId: { type: 'string', description: 'The object type ID of the surviving record' },
    recordId: { type: 'string', description: 'The surviving record ID after merge' },
    duplicateObjectId: {
      type: 'string',
      description: 'The object type ID of the merged-away record',
    },
    duplicateRecordId: { type: 'string', description: 'The record ID that was merged away' },
  }
}

/**
 * Note event outputs.
 */
function buildNoteIdOutputs(): Record<string, TriggerOutput> {
  return {
    workspaceId: { type: 'string', description: 'The workspace ID' },
    noteId: { type: 'string', description: 'The note ID' },
    parentObjectId: { type: 'string', description: 'The parent object type ID' },
    parentRecordId: { type: 'string', description: 'The parent record ID' },
  }
}

/**
 * Task event outputs.
 * Attio task webhook payloads only contain workspace_id and task_id.
 */
function buildTaskIdOutputs(): Record<string, TriggerOutput> {
  return {
    workspaceId: { type: 'string', description: 'The workspace ID' },
    taskId: { type: 'string', description: 'The task ID' },
  }
}

/**
 * Comment event outputs.
 * Attio payload uses object_id/record_id (not parent_*), plus list_id/entry_id.
 */
function buildCommentIdOutputs(): Record<string, TriggerOutput> {
  return {
    workspaceId: { type: 'string', description: 'The workspace ID' },
    threadId: { type: 'string', description: 'The thread ID' },
    commentId: { type: 'string', description: 'The comment ID' },
    objectId: { type: 'string', description: 'The object type ID' },
    recordId: { type: 'string', description: 'The record ID' },
    listId: { type: 'string', description: 'The list ID (if comment is on a list entry)' },
    entryId: { type: 'string', description: 'The list entry ID (if comment is on a list entry)' },
  }
}

/**
 * List entry event outputs.
 */
function buildListEntryIdOutputs(): Record<string, TriggerOutput> {
  return {
    workspaceId: { type: 'string', description: 'The workspace ID' },
    listId: { type: 'string', description: 'The list ID' },
    entryId: { type: 'string', description: 'The list entry ID' },
  }
}

/**
 * List entry updated event outputs (includes attributeId).
 */
function buildListEntryUpdatedIdOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildListEntryIdOutputs(),
    attributeId: {
      type: 'string',
      description: 'The ID of the attribute that was updated on the list entry',
    },
  }
}

/** Record created/deleted outputs. */
export function buildRecordOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildRecordIdOutputs(),
  }
}

/** Record updated outputs (includes attributeId). */
export function buildRecordUpdatedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildRecordUpdatedIdOutputs(),
  }
}

/** Record merged outputs. */
export function buildRecordMergedEventOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildRecordMergedOutputs(),
  }
}

/** Note event outputs. */
export function buildNoteOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildNoteIdOutputs(),
  }
}

/** Task event outputs. */
export function buildTaskOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildTaskIdOutputs(),
  }
}

/** Comment event outputs. */
export function buildCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildCommentIdOutputs(),
  }
}

/** List entry created/deleted outputs. */
export function buildListEntryOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildListEntryIdOutputs(),
  }
}

/** List entry updated outputs (includes attributeId). */
export function buildListEntryUpdatedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    ...buildListEntryUpdatedIdOutputs(),
  }
}

/** Generic webhook outputs covering all event types. */
export function buildGenericWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    id: { type: 'json', description: 'The event ID object containing resource identifiers' },
    parentObjectId: {
      type: 'string',
      description: 'The parent object type ID (if applicable)',
    },
    parentRecordId: {
      type: 'string',
      description: 'The parent record ID (if applicable)',
    },
  }
}

/**
 * Maps trigger IDs to the exact Attio event type strings.
 */
export const TRIGGER_EVENT_MAP: Record<string, string[]> = {
  attio_record_created: ['record.created'],
  attio_record_updated: ['record.updated'],
  attio_record_deleted: ['record.deleted'],
  attio_record_merged: ['record.merged'],
  attio_note_created: ['note.created'],
  attio_note_updated: ['note.updated', 'note.content-updated'],
  attio_note_deleted: ['note.deleted'],
  attio_task_created: ['task.created'],
  attio_task_updated: ['task.updated'],
  attio_task_deleted: ['task.deleted'],
  attio_comment_created: ['comment.created'],
  attio_comment_resolved: ['comment.resolved'],
  attio_comment_unresolved: ['comment.unresolved'],
  attio_comment_deleted: ['comment.deleted'],
  attio_list_entry_created: ['list-entry.created'],
  attio_list_entry_updated: ['list-entry.updated'],
  attio_list_entry_deleted: ['list-entry.deleted'],
}

/**
 * Checks if an Attio webhook payload matches a trigger.
 */
export function isAttioPayloadMatch(triggerId: string, body: Record<string, unknown>): boolean {
  if (triggerId === 'attio_webhook') {
    return true
  }

  const eventType = body.event_type as string | undefined
  if (!eventType) {
    return false
  }

  const acceptedEvents = TRIGGER_EVENT_MAP[triggerId]
  return acceptedEvents ? acceptedEvents.includes(eventType) : false
}
