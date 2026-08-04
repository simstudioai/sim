import { getScopesForService } from '@/lib/oauth/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export type QuickBooksWebhookAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'merged'
  | 'voided'
  | 'emailed'

export interface QuickBooksTriggerDefinition {
  actions: readonly QuickBooksWebhookAction[]
  entity: string
  entityType: string
  group: string
  id: string
  label: string
}

export const QUICKBOOKS_TRIGGER_DEFINITIONS: readonly QuickBooksTriggerDefinition[] = [
  {
    id: 'quickbooks_customer_events',
    label: 'Customer Events',
    group: 'Sales and Receivables',
    entity: 'customer',
    entityType: 'Customer',
    actions: ['created', 'updated', 'deleted', 'merged'],
  },
  {
    id: 'quickbooks_invoice_events',
    label: 'Invoice Events',
    group: 'Sales and Receivables',
    entity: 'invoice',
    entityType: 'Invoice',
    actions: ['created', 'updated', 'deleted', 'voided', 'emailed'],
  },
  {
    id: 'quickbooks_payment_events',
    label: 'Payment Events',
    group: 'Sales and Receivables',
    entity: 'payment',
    entityType: 'Payment',
    actions: ['created', 'updated', 'deleted', 'voided', 'emailed'],
  },
  {
    id: 'quickbooks_vendor_events',
    label: 'Vendor Events',
    group: 'Purchasing and Payables',
    entity: 'vendor',
    entityType: 'Vendor',
    actions: ['created', 'updated', 'deleted', 'merged'],
  },
  {
    id: 'quickbooks_bill_events',
    label: 'Bill Events',
    group: 'Purchasing and Payables',
    entity: 'bill',
    entityType: 'Bill',
    actions: ['created', 'updated', 'deleted'],
  },
  {
    id: 'quickbooks_bill_payment_events',
    label: 'Bill Payment Events',
    group: 'Purchasing and Payables',
    entity: 'billpayment',
    entityType: 'BillPayment',
    actions: ['created', 'updated', 'deleted', 'voided'],
  },
  {
    id: 'quickbooks_purchase_order_events',
    label: 'Purchase Order Events',
    group: 'Purchasing and Payables',
    entity: 'purchaseorder',
    entityType: 'PurchaseOrder',
    actions: ['created', 'updated', 'deleted', 'emailed'],
  },
] as const

export const quickBooksTriggerOptions = QUICKBOOKS_TRIGGER_DEFINITIONS.map((definition) => ({
  label: definition.label,
  id: definition.id,
  group: definition.group,
}))

export const QUICKBOOKS_WEBHOOK_HEADERS = {
  'Content-Type': 'application/json',
  'intuit-signature': '<base64-hmac-sha256>',
} as const

export function getQuickBooksTriggerDefinition(
  triggerId: string
): QuickBooksTriggerDefinition | undefined {
  return QUICKBOOKS_TRIGGER_DEFINITIONS.find((definition) => definition.id === triggerId)
}

export function parseQuickBooksWebhookType(type: string): {
  action: string
  entity: string
} | null {
  const match = /^qbo\.([a-z]+)\.([a-z]+)\.v1$/.exec(type)
  return match ? { entity: match[1], action: match[2] } : null
}

export function isQuickBooksEventMatch(
  triggerId: string,
  eventType: string,
  selectedActions: unknown
): boolean {
  const definition = getQuickBooksTriggerDefinition(triggerId)
  const parsed = parseQuickBooksWebhookType(eventType)
  if (!definition || !parsed || parsed.entity !== definition.entity) return false
  if (!definition.actions.includes(parsed.action as QuickBooksWebhookAction)) return false
  return Array.isArray(selectedActions) && selectedActions.includes(parsed.action)
}

export function buildQuickBooksTriggerSubBlocks(triggerId: string): SubBlockConfig[] {
  const definition = getQuickBooksTriggerDefinition(triggerId)
  if (!definition) throw new Error(`Unknown QuickBooks trigger: ${triggerId}`)

  return [
    {
      id: 'triggerCredentials',
      title: 'QuickBooks Account',
      type: 'oauth-input',
      serviceId: 'quickbooks',
      requiredScopes: getScopesForService('quickbooks'),
      mode: 'trigger',
      required: true,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'eventTypes',
      title: 'Event Types',
      type: 'dropdown',
      multiSelect: true,
      options: definition.actions.map((action) => ({
        label: action.charAt(0).toUpperCase() + action.slice(1),
        id: action,
      })),
      mode: 'trigger',
      required: true,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function buildQuickBooksTriggerOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: { type: 'string', description: 'Intuit webhook event ID' },
    eventType: { type: 'string', description: 'Full Intuit CloudEvent type' },
    entityType: { type: 'string', description: 'QuickBooks entity type' },
    action: { type: 'string', description: 'QuickBooks webhook action' },
    entityId: { type: 'string', description: 'QuickBooks entity ID' },
    realmId: { type: 'string', description: 'QuickBooks company realm ID' },
    eventTime: { type: 'string', description: 'Event timestamp' },
    specVersion: { type: 'string', description: 'CloudEvents specification version' },
    source: { type: 'string', description: 'Intuit event source' },
    contentType: { type: 'string', description: 'Event content type, when provided' },
    data: { type: 'json', description: 'Optional event data supplied by Intuit' },
  }
}
