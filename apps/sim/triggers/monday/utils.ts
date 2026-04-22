import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const mondayTriggerOptions = [
  { label: 'Item Created', id: 'monday_item_created' },
  { label: 'Column Value Changed', id: 'monday_column_changed' },
  { label: 'Status Changed', id: 'monday_status_changed' },
  { label: 'Item Name Changed', id: 'monday_item_name_changed' },
  { label: 'Item Archived', id: 'monday_item_archived' },
  { label: 'Item Deleted', id: 'monday_item_deleted' },
  { label: 'Item Moved to Group', id: 'monday_item_moved' },
  { label: 'Subitem Created', id: 'monday_subitem_created' },
  { label: 'Update Posted', id: 'monday_update_created' },
]

/**
 * Maps trigger IDs to Monday.com webhook event types used in the
 * `create_webhook` GraphQL mutation.
 */
export const MONDAY_EVENT_TYPE_MAP: Record<string, string> = {
  monday_item_created: 'create_item',
  monday_column_changed: 'change_column_value',
  monday_status_changed: 'change_status_column_value',
  monday_item_name_changed: 'change_name',
  monday_item_archived: 'item_archived',
  monday_item_deleted: 'item_deleted',
  monday_item_moved: 'item_moved_to_any_group',
  monday_subitem_created: 'create_subitem',
  monday_update_created: 'create_update',
}

export function mondaySetupInstructions(eventType: string): string {
  const instructions = [
    `This trigger automatically subscribes to <strong>${eventType}</strong> events on the specified board.`,
    'Select your <strong>Monday.com account</strong> above.',
    'Enter the <strong>Board ID</strong> you want to monitor. You can find it in the board URL: <code>https://your-org.monday.com/boards/<strong>BOARD_ID</strong></code>.',
    'Click <strong>"Save"</strong> to activate the trigger. The webhook will be created automatically.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Builds the subBlock configuration for Monday.com triggers with auto-subscription.
 * Pattern follows Linear V2: [dropdown?] → OAuth credential → boardId → instructions
 */
export function buildMondaySubBlocks(options: {
  triggerId: string
  eventType: string
  includeDropdown?: boolean
}): SubBlockConfig[] {
  const { triggerId, eventType, includeDropdown } = options
  const subBlocks: SubBlockConfig[] = []

  if (includeDropdown) {
    subBlocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      options: mondayTriggerOptions,
      value: () => triggerId,
      mode: 'trigger',
    })
  }

  subBlocks.push(
    {
      id: 'triggerCredentials',
      title: 'Monday Account',
      type: 'oauth-input',
      description: 'Select your Monday.com account to create the webhook automatically.',
      serviceId: 'monday',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'boardId',
      title: 'Board ID',
      type: 'short-input',
      placeholder: 'Enter the board ID from the board URL',
      description: 'The ID of the board to monitor. Find it in the URL: monday.com/boards/BOARD_ID',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: mondaySetupInstructions(eventType),
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    }
  )

  return subBlocks
}

const baseEventOutputs: Record<string, TriggerOutput> = {
  boardId: { type: 'string', description: 'The board ID where the event occurred' },
  itemId: { type: 'string', description: 'The item ID (pulseId)' },
  itemName: { type: 'string', description: 'The item name (pulseName)' },
  groupId: { type: 'string', description: 'The group ID of the item' },
  userId: { type: 'string', description: 'The ID of the user who triggered the event' },
  triggerTime: { type: 'string', description: 'ISO timestamp of when the event occurred' },
  triggerUuid: { type: 'string', description: 'Unique identifier for this event' },
  subscriptionId: { type: 'string', description: 'The webhook subscription ID' },
}

export function buildItemOutputs(): Record<string, TriggerOutput> {
  return { ...baseEventOutputs }
}

export function buildItemMovedOutputs(): Record<string, TriggerOutput> {
  return {
    ...baseEventOutputs,
    destGroupId: { type: 'string', description: 'The destination group ID the item was moved to' },
    sourceGroupId: { type: 'string', description: 'The source group ID the item was moved from' },
  }
}

export function buildColumnChangeOutputs(): Record<string, TriggerOutput> {
  return {
    ...baseEventOutputs,
    columnId: { type: 'string', description: 'The ID of the changed column' },
    columnType: { type: 'string', description: 'The type of the changed column' },
    columnTitle: { type: 'string', description: 'The title of the changed column' },
    value: { type: 'json', description: 'The new value of the column' },
    previousValue: { type: 'json', description: 'The previous value of the column' },
  }
}

export function buildSubitemOutputs(): Record<string, TriggerOutput> {
  return {
    ...baseEventOutputs,
    parentItemId: { type: 'string', description: 'The parent item ID' },
    parentItemBoardId: { type: 'string', description: 'The parent item board ID' },
  }
}

export function buildUpdateOutputs(): Record<string, TriggerOutput> {
  return {
    ...baseEventOutputs,
    updateId: { type: 'string', description: 'The ID of the created update' },
    body: { type: 'string', description: 'The HTML body of the update' },
    textBody: { type: 'string', description: 'The plain text body of the update' },
  }
}
