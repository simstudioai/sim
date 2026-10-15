import { FivetranIcon } from '@/components/icons'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerConfig, TriggerOutput } from '@/triggers/types'

/** The catch-all trigger: runs on every event the Fivetran webhook delivers. */
export const FIVETRAN_ALL_EVENTS_TRIGGER_ID = 'fivetran_webhook'

type FivetranEventData =
  | 'sync'
  | 'syncStart'
  | 'setupTest'
  | 'connectorCreated'
  | 'connectorEdited'
  | 'pause'
  | 'actor'
  | 'table'
  | 'transformationStart'
  | 'transformationEnd'

interface FivetranEventDefinition {
  triggerId: string
  label: string
  event: string
  data: FivetranEventData
  description: string
}

/**
 * Every typed Fivetran trigger and the webhook event it subscribes to. The deprecated
 * `status` event is omitted.
 */
const FIVETRAN_EVENTS: readonly FivetranEventDefinition[] = [
  {
    triggerId: 'fivetran_sync_end',
    label: 'Sync Ended',
    event: 'sync_end',
    data: 'sync',
    description:
      'Trigger workflow when a connection sync finishes, succeeds, fails, or is rescheduled',
  },
  {
    triggerId: 'fivetran_sync_start',
    label: 'Sync Started',
    event: 'sync_start',
    data: 'syncStart',
    description: 'Trigger workflow when a connection starts syncing',
  },
  {
    triggerId: 'fivetran_connection_failure',
    label: 'Connection Failed',
    event: 'connection_failure',
    data: 'setupTest',
    description: 'Trigger workflow when Fivetran fails to connect to a source',
  },
  {
    triggerId: 'fivetran_connection_successful',
    label: 'Connection Succeeded',
    event: 'connection_successful',
    data: 'setupTest',
    description: 'Trigger workflow when Fivetran connects to a source successfully',
  },
  {
    triggerId: 'fivetran_create_connector',
    label: 'Connection Created',
    event: 'create_connector',
    data: 'connectorCreated',
    description: 'Trigger workflow when a connection is created',
  },
  {
    triggerId: 'fivetran_edit_connector',
    label: 'Connection Edited',
    event: 'edit_connector',
    data: 'connectorEdited',
    description:
      'Trigger workflow when connection credentials, sync frequency, or other settings change',
  },
  {
    triggerId: 'fivetran_pause_connector',
    label: 'Connection Paused',
    event: 'pause_connector',
    data: 'pause',
    description: 'Trigger workflow when a connection is paused, by a user or automatically',
  },
  {
    triggerId: 'fivetran_resume_connector',
    label: 'Connection Resumed',
    event: 'resume_connector',
    data: 'actor',
    description: 'Trigger workflow when a connection is resumed',
  },
  {
    triggerId: 'fivetran_delete_connector',
    label: 'Connection Deleted',
    event: 'delete_connector',
    data: 'actor',
    description: 'Trigger workflow when a connection is deleted',
  },
  {
    triggerId: 'fivetran_force_update_connector',
    label: 'Manual Sync Triggered',
    event: 'force_update_connector',
    data: 'actor',
    description: 'Trigger workflow when someone triggers a manual sync of a connection',
  },
  {
    triggerId: 'fivetran_resync_connector',
    label: 'Connection Re-sync Triggered',
    event: 'resync_connector',
    data: 'actor',
    description: 'Trigger workflow when a historical re-sync of a connection is triggered',
  },
  {
    triggerId: 'fivetran_resync_table',
    label: 'Table Re-sync Triggered',
    event: 'resync_table',
    data: 'table',
    description: 'Trigger workflow when a historical re-sync of a table is triggered',
  },
  {
    triggerId: 'fivetran_transformation_start',
    label: 'Transformation Started',
    event: 'transformation_start',
    data: 'transformationStart',
    description: 'Trigger workflow when a transformation run starts',
  },
  {
    triggerId: 'fivetran_transformation_succeeded',
    label: 'Transformation Succeeded',
    event: 'transformation_succeeded',
    data: 'transformationEnd',
    description: 'Trigger workflow when a transformation run succeeds',
  },
  {
    triggerId: 'fivetran_transformation_failed',
    label: 'Transformation Failed',
    event: 'transformation_failed',
    data: 'transformationEnd',
    description: 'Trigger workflow when a transformation run fails',
  },
]

const EVENTS_BY_TRIGGER_ID = new Map(FIVETRAN_EVENTS.map((event) => [event.triggerId, event]))

const fivetranTriggerOptions = [
  ...FIVETRAN_EVENTS.map((event) => ({ label: event.label, id: event.triggerId })),
  { label: 'All Events', id: FIVETRAN_ALL_EVENTS_TRIGGER_ID },
]

/** The Fivetran events a trigger subscribes its webhook to, or null for an unknown trigger. */
export function getFivetranWebhookEvents(triggerId: string): string[] | null {
  if (triggerId === FIVETRAN_ALL_EVENTS_TRIGGER_ID) return FIVETRAN_EVENTS.map((e) => e.event)
  const event = EVENTS_BY_TRIGGER_ID.get(triggerId)
  return event ? [event.event] : null
}

/** Whether a delivered event belongs to the trigger. */
export function isFivetranEventMatch(triggerId: string, event: string): boolean {
  if (triggerId === FIVETRAN_ALL_EVENTS_TRIGGER_ID) return true
  return EVENTS_BY_TRIGGER_ID.get(triggerId)?.event === event
}

function fivetranSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Enter a Fivetran API key and secret above. In Fivetran, click your username, then <strong>API Key</strong> &gt; <strong>Generate API key</strong>. The key acts with your permissions, so it must be able to manage webhooks for the account or group.',
    'Leave <strong>Group ID</strong> empty to receive events from every destination in the account, or enter a group ID to limit the webhook to that destination.',
    `When you deploy the workflow, Sim registers a webhook in Fivetran for <strong>${eventLabel}</strong> events with its own signing secret, and rejects deliveries that are not signed with it.`,
    'The webhook is deleted from Fivetran when you remove this trigger and redeploy.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/** Builds the trigger-mode fields shared by every Fivetran trigger. */
export function buildFivetranSubBlocks(options: {
  triggerId: string
  eventLabel: string
  includeDropdown?: boolean
  /** Transformation events describe a dbt job, not a connection, so they take no connection filter. */
  connectionFilter?: boolean
}): SubBlockConfig[] {
  const { triggerId, eventLabel, includeDropdown = false, connectionFilter = true } = options
  const condition = { field: 'selectedTriggerId', value: triggerId }
  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: fivetranTriggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  blocks.push(
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Fivetran API key',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition,
    },
    {
      id: 'apiSecret',
      title: 'API Secret',
      type: 'short-input',
      placeholder: 'Enter your Fivetran API secret',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition,
    },
    {
      id: 'triggerGroupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Leave empty for every group in the account',
      mode: 'trigger',
      condition,
    },
    ...(connectionFilter
      ? [
          {
            id: 'triggerConnectionId',
            title: 'Connection ID',
            type: 'short-input' as const,
            placeholder: 'Leave empty for every connection',
            mode: 'trigger' as const,
            condition,
          },
        ]
      : []),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: fivetranSetupInstructions(eventLabel),
      mode: 'trigger',
      condition,
    }
  )

  return blocks
}

/** Envelope fields Fivetran sends with every webhook event. */
export const FIVETRAN_EVENT_OUTPUTS = {
  event: { type: 'string', description: 'Event type, e.g. sync_end' },
  createdAt: { type: 'string', description: 'When the event was generated (ISO 8601)' },
  connectorType: { type: 'string', description: 'Connector type of the connection, e.g. okta' },
  connectorId: { type: 'string', description: 'Connection ID' },
  connectorName: { type: 'string', description: 'Connection name (its destination schema)' },
  syncId: { type: 'string', description: 'ID of the sync the event belongs to' },
  destinationGroupId: { type: 'string', description: 'Group ID of the destination' },
} as const satisfies Record<string, TriggerOutput>

const ACTOR_OUTPUT = {
  actor: {
    type: 'string',
    description: 'Internal ID of the user who acted, or _fivetran_system for automatic actions',
  },
  id: { type: 'string', description: 'Connection ID' },
} as const satisfies Record<string, TriggerOutput>

const TRANSFORMATION_START_OUTPUT = {
  id: { type: 'string', description: 'Transformation job ID' },
  name: { type: 'string', description: 'Transformation job name' },
  startTime: { type: 'string', description: 'When the run started' },
  transformationType: {
    type: 'string',
    description: 'Job type (DBT_CORE, QUICKSTART, DBT_CLOUD, COALESCE)',
  },
  schedule: { type: 'json', description: 'Job schedule (type and entries)' },
} as const satisfies Record<string, TriggerOutput>

const EVENT_DATA_OUTPUTS: Record<FivetranEventData, Record<string, TriggerOutput>> = {
  sync: {
    status: {
      type: 'string',
      description: 'Sync status (SUCCESSFUL, FAILURE, FAILURE_WITH_TASK, RESCHEDULED)',
    },
    sync_type: { type: 'string', description: 'HISTORICAL or INCREMENTAL' },
    load_volume_b: {
      type: 'number',
      description: 'Bytes loaded into the destination, on successful syncs that report it',
    },
    reason: { type: 'string', description: 'Why the sync failed or was rescheduled' },
    taskType: {
      type: 'string',
      description: 'Error type behind a FAILURE_WITH_TASK or RESCHEDULED status, e.g. reconnect',
    },
    rescheduledAt: { type: 'string', description: 'When a rescheduled sync resumes' },
    isRoutine: {
      type: 'boolean',
      description: 'Whether a reschedule is routine rather than error-driven',
    },
  },
  syncStart: {
    sync_type: { type: 'string', description: 'HISTORICAL or INCREMENTAL' },
  },
  setupTest: {
    ...ACTOR_OUTPUT,
    testName: { type: 'string', description: 'Name of the setup test' },
    message: { type: 'string', description: 'Test result message' },
  },
  connectorCreated: {
    ...ACTOR_OUTPUT,
    properties: { type: 'json', description: 'Connector-specific properties, with secrets masked' },
  },
  connectorEdited: {
    ...ACTOR_OUTPUT,
    editType: { type: 'string', description: 'What was edited, e.g. CREDENTIALS' },
    properties: { type: 'json', description: 'Connector-specific properties, with secrets masked' },
    oldProperties: {
      type: 'json',
      description: 'Connector-specific properties before the edit, with secrets masked',
    },
  },
  pause: {
    ...ACTOR_OUTPUT,
    reason: { type: 'string', description: 'Why the connection was paused automatically' },
  },
  actor: ACTOR_OUTPUT,
  table: {
    ...ACTOR_OUTPUT,
    schema: { type: 'string', description: 'Schema name' },
    table: { type: 'string', description: 'Table name' },
  },
  transformationStart: TRANSFORMATION_START_OUTPUT,
  transformationEnd: {
    ...TRANSFORMATION_START_OUTPUT,
    endTime: { type: 'string', description: 'When the run ended' },
    result: {
      type: 'json',
      description:
        'Run result with stepResults (step, success, start and end times, commandResult)',
    },
  },
}

/** Builds a typed Fivetran trigger from its event definition. */
export function createFivetranTrigger(
  triggerId: string,
  options: { includeDropdown?: boolean } = {}
): TriggerConfig {
  const event = EVENTS_BY_TRIGGER_ID.get(triggerId)
  if (!event) throw new Error(`Unknown Fivetran trigger: ${triggerId}`)
  return {
    id: event.triggerId,
    name: `Fivetran ${event.label}`,
    provider: 'fivetran',
    description: event.description,
    version: '1.0.0',
    icon: FivetranIcon,
    subBlocks: buildFivetranSubBlocks({
      triggerId: event.triggerId,
      eventLabel: event.label,
      includeDropdown: options.includeDropdown,
      connectionFilter: !event.event.startsWith('transformation_'),
    }),
    outputs: {
      ...FIVETRAN_EVENT_OUTPUTS,
      data: EVENT_DATA_OUTPUTS[event.data],
    } as Record<string, TriggerOutput>,
    webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  }
}
