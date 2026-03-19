import { extractSoapBody, stripNamespacePrefixes } from '@/lib/webhooks/soap-utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Workday SOAP notification payload types.
 * Based on official docs: Notification Service v29.0 — Receive_Notification operation.
 */
export interface WorkdayObjectId {
  _text?: string
  '@_type'?: string
  '@_parent_id'?: string
  '@_parent_type'?: string
}

export interface WorkdayObjectReference {
  '@_Descriptor'?: string
  ID?: WorkdayObjectId | WorkdayObjectId[]
}

export interface WorkdayEventData {
  Event_Reference: WorkdayObjectReference
  Event_Name: string
  Notification_Trigger: string
  Event_Completion_Date: string
  Event_Effective_Date?: string
  Tenant_Name: string
  System_ID: string
  Transaction_Target_Reference?: WorkdayObjectReference | WorkdayObjectReference[]
}

export interface WorkdayNotificationData {
  Event_Data: WorkdayEventData
}

export type WorkdayTriggerId =
  | 'workday_employee_hired'
  | 'workday_employee_terminated'
  | 'workday_job_changed'
  | 'workday_webhook'

export const workdayTriggerOptions = [
  { label: 'Employee Hired', id: 'workday_employee_hired' },
  { label: 'Employee Terminated', id: 'workday_employee_terminated' },
  { label: 'Job Changed', id: 'workday_job_changed' },
  { label: 'Generic Webhook', id: 'workday_webhook' },
]

export function workdaySetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Workday ISU credentials and Integration System ID above.',
    `When you deploy this workflow, a subscription for <strong>${eventType}</strong> events will be automatically created in Workday via the Put_Subscription API.`,
    'Ensure the ISU has domain security permissions for <strong>Integration Build</strong> and <strong>Integration Process</strong>.',
    'The subscription will be automatically disabled when you undeploy the workflow.',
    'SOAP XML notifications from Workday are automatically parsed into JSON for your workflow.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildWorkdaySubBlocks(options: {
  triggerId: string
  eventType: string
  includeDropdown?: boolean
}): SubBlockConfig[] {
  const { triggerId, eventType, includeDropdown = false } = options
  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: workdayTriggerOptions,
      value: () => triggerId,
      required: true,
    })

    blocks.push({
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    })
  }

  blocks.push(
    {
      id: 'tenantUrl',
      title: 'Tenant URL',
      type: 'short-input',
      placeholder: 'https://wd2-impl-services1.workday.com',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'tenant',
      title: 'Tenant Name',
      type: 'short-input',
      placeholder: 'mycompany',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'username',
      title: 'ISU Username',
      type: 'short-input',
      placeholder: 'Integration System User username',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'password',
      title: 'ISU Password',
      type: 'short-input',
      placeholder: 'Integration System User password',
      password: true,
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'integrationSystemId',
      title: 'Integration System ID',
      type: 'short-input',
      placeholder: 'Workday Integration System ID',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
      description: 'The Integration System ID configured in Workday for this subscription',
    }
  )

  blocks.push({
    id: 'triggerSave',
    title: '',
    type: 'trigger-save',
    hideFromPreview: true,
    mode: 'trigger',
    triggerId,
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: workdaySetupInstructions(eventType),
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}

/**
 * Extracts the typed WorkdayEventData from a raw parsed SOAP webhook body.
 * Handles namespace stripping and SOAP envelope unwrapping.
 */
export function extractWorkdayEventData(body: Record<string, unknown>): WorkdayEventData | null {
  const cleaned = stripNamespacePrefixes(extractSoapBody(body)) as Record<string, unknown>
  const notificationData = cleaned.Notification_Data as WorkdayNotificationData | undefined
  const eventData = (cleaned.Event_Data ??
    notificationData?.Event_Data ??
    null) as WorkdayEventData | null

  return eventData
}

/**
 * Extracts the first ID value from a WorkdayObjectReference.
 */
export function extractWorkdayRefId(ref: WorkdayObjectReference | undefined): string | null {
  if (!ref?.ID) return null
  const ids = Array.isArray(ref.ID) ? ref.ID : [ref.ID]
  return ids[0]?._text ?? null
}

/**
 * Checks whether a parsed SOAP webhook body matches a specific Workday event type.
 * Workday sends all subscribed events to the same endpoint, so we filter here.
 */
export function isWorkdayEventMatch(
  triggerId: WorkdayTriggerId | string,
  body: Record<string, unknown>
): boolean {
  const eventData = extractWorkdayEventData(body)
  if (!eventData) return triggerId === 'workday_webhook'

  const eventName = eventData.Event_Name ?? ''
  const trigger = eventData.Notification_Trigger ?? ''

  switch (triggerId) {
    case 'workday_employee_hired':
      return trigger.includes('Hire') || eventName.startsWith('Hire')
    case 'workday_employee_terminated':
      return trigger.includes('Terminat') || eventName.startsWith('Terminat')
    case 'workday_job_changed':
      return (
        trigger.includes('Change_Job') ||
        trigger.includes('Job_Change') ||
        eventName.startsWith('Change Job')
      )
    case 'workday_webhook':
      return true
    default:
      return true
  }
}

/**
 * Core output fields present in all Workday notification payloads.
 */
function buildEventOutputs(): Record<string, TriggerOutput> {
  return {
    eventName: { type: 'string', description: 'Name of the business process event' },
    eventReference: { type: 'string', description: 'Workday event reference ID' },
    notificationTrigger: { type: 'string', description: 'Trigger type identifier' },
    eventCompletionDate: { type: 'string', description: 'Event completion timestamp (ISO 8601)' },
    eventEffectiveDate: { type: 'string', description: 'Event effective date (YYYY-MM-DD)' },
    tenantName: { type: 'string', description: 'Workday tenant name' },
    systemId: { type: 'string', description: 'Integration system ID' },
    targetReference: {
      type: 'string',
      description: 'Reference to the affected business object (e.g., worker ID)',
    },
  }
}

export function buildEmployeeHiredOutputs(): Record<string, TriggerOutput> {
  return buildEventOutputs()
}

export function buildEmployeeTerminatedOutputs(): Record<string, TriggerOutput> {
  return buildEventOutputs()
}

export function buildJobChangedOutputs(): Record<string, TriggerOutput> {
  return buildEventOutputs()
}

export function buildGenericWebhookOutputs(): Record<string, TriggerOutput> {
  return buildEventOutputs()
}
