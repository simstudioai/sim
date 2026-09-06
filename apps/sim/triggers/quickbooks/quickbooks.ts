import { QuickBooksIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerConfig, TriggerOutput } from '@/triggers/types'

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
    id: 'quickbooks_estimate_events',
    label: 'Estimate Events',
    group: 'Sales and Receivables',
    entity: 'estimate',
    entityType: 'Estimate',
    actions: ['created', 'updated', 'deleted', 'emailed'],
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
    id: 'quickbooks_credit_memo_events',
    label: 'Credit Memo Events',
    group: 'Sales and Receivables',
    entity: 'creditmemo',
    entityType: 'CreditMemo',
    actions: ['created', 'updated', 'deleted', 'voided', 'emailed'],
  },
  {
    id: 'quickbooks_refund_receipt_events',
    label: 'Refund Receipt Events',
    group: 'Sales and Receivables',
    entity: 'refundreceipt',
    entityType: 'RefundReceipt',
    actions: ['created', 'updated', 'deleted', 'voided', 'emailed'],
  },
  {
    id: 'quickbooks_sales_receipt_events',
    label: 'Sales Receipt Events',
    group: 'Sales and Receivables',
    entity: 'salesreceipt',
    entityType: 'SalesReceipt',
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
  {
    id: 'quickbooks_purchase_events',
    label: 'Purchase Events',
    group: 'Purchasing and Payables',
    entity: 'purchase',
    entityType: 'Purchase',
    actions: ['created', 'updated', 'deleted', 'voided'],
  },
  {
    id: 'quickbooks_vendor_credit_events',
    label: 'Vendor Credit Events',
    group: 'Purchasing and Payables',
    entity: 'vendorcredit',
    entityType: 'VendorCredit',
    actions: ['created', 'updated', 'deleted'],
  },
  {
    id: 'quickbooks_deposit_events',
    label: 'Deposit Events',
    group: 'Accounting',
    entity: 'deposit',
    entityType: 'Deposit',
    actions: ['created', 'updated', 'deleted'],
  },
  {
    id: 'quickbooks_journal_entry_events',
    label: 'Journal Entry Events',
    group: 'Accounting',
    entity: 'journalentry',
    entityType: 'JournalEntry',
    actions: ['created', 'updated', 'deleted'],
  },
  {
    id: 'quickbooks_transfer_events',
    label: 'Transfer Events',
    group: 'Accounting',
    entity: 'transfer',
    entityType: 'Transfer',
    actions: ['created', 'updated', 'deleted', 'voided'],
  },
  {
    id: 'quickbooks_item_events',
    label: 'Item Events',
    group: 'Products and People',
    entity: 'item',
    entityType: 'Item',
    actions: ['created', 'updated', 'deleted', 'merged'],
  },
  {
    id: 'quickbooks_employee_events',
    label: 'Employee Events',
    group: 'Products and People',
    entity: 'employee',
    entityType: 'Employee',
    actions: ['created', 'updated', 'deleted', 'merged'],
  },
  {
    id: 'quickbooks_time_activity_events',
    label: 'Time Activity Events',
    group: 'Products and People',
    entity: 'timeactivity',
    entityType: 'TimeActivity',
    actions: ['created', 'updated', 'deleted'],
  },
  {
    id: 'quickbooks_account_events',
    label: 'Account Events',
    group: 'Company and Setup',
    entity: 'account',
    entityType: 'Account',
    actions: ['created', 'updated', 'deleted', 'merged'],
  },
  {
    id: 'quickbooks_budget_events',
    label: 'Budget Events',
    group: 'Company and Setup',
    entity: 'budget',
    entityType: 'Budget',
    actions: ['created', 'updated'],
  },
  {
    id: 'quickbooks_class_events',
    label: 'Class Events',
    group: 'Company and Setup',
    entity: 'class',
    entityType: 'Class',
    actions: ['created', 'updated', 'deleted', 'merged'],
  },
  {
    id: 'quickbooks_currency_events',
    label: 'Currency Events',
    group: 'Company and Setup',
    entity: 'currency',
    entityType: 'Currency',
    actions: ['created', 'updated'],
  },
  {
    id: 'quickbooks_department_events',
    label: 'Department Events',
    group: 'Company and Setup',
    entity: 'department',
    entityType: 'Department',
    actions: ['created', 'updated', 'merged'],
  },
  {
    id: 'quickbooks_journal_code_events',
    label: 'Journal Code Events',
    group: 'Company and Setup',
    entity: 'journalcode',
    entityType: 'JournalCode',
    actions: ['created', 'updated'],
  },
  {
    id: 'quickbooks_payment_method_events',
    label: 'Payment Method Events',
    group: 'Company and Setup',
    entity: 'paymentmethod',
    entityType: 'PaymentMethod',
    actions: ['created', 'updated', 'merged'],
  },
  {
    id: 'quickbooks_preferences_updated',
    label: 'Preferences Updated',
    group: 'Company and Setup',
    entity: 'preferences',
    entityType: 'Preferences',
    actions: ['updated'],
  },
  {
    id: 'quickbooks_tax_agency_events',
    label: 'Tax Agency Events',
    group: 'Company and Setup',
    entity: 'taxagency',
    entityType: 'TaxAgency',
    actions: ['created', 'updated'],
  },
  {
    id: 'quickbooks_term_events',
    label: 'Term Events',
    group: 'Company and Setup',
    entity: 'term',
    entityType: 'Term',
    actions: ['created', 'updated'],
  },
] as const

export const quickBooksTriggerOptions = QUICKBOOKS_TRIGGER_DEFINITIONS.map((definition) => ({
  label: definition.label,
  id: definition.id,
  group: definition.group,
}))

export function quickBooksEventTypesSubBlockId(triggerId: string): string {
  return `eventTypes_${triggerId}`
}

export const QUICKBOOKS_WEBHOOK_HEADERS = {
  'Content-Type': 'application/json',
  'intuit-signature': '<base64-hmac-sha256>',
} as const

export function getQuickBooksTriggerDefinition(
  triggerId: string
): QuickBooksTriggerDefinition | undefined {
  return QUICKBOOKS_TRIGGER_DEFINITIONS.find((definition) => definition.id === triggerId)
}

/** Resolves the definition addressed by an event's lowercase wire entity token. */
export function getQuickBooksTriggerDefinitionByEntity(
  entity: string
): QuickBooksTriggerDefinition | undefined {
  return QUICKBOOKS_TRIGGER_DEFINITIONS.find((definition) => definition.entity === entity)
}

export function parseQuickBooksWebhookType(type: string): {
  action: string
  entity: string
} | null {
  const match = /^qbo\.([a-z]+)\.([a-z]+)\.v1$/.exec(type)
  if (!match) return null
  return { entity: match[1], action: match[2] === 'void' ? 'voided' : match[2] }
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
  if (definition.actions.length === 1) return true
  return Array.isArray(selectedActions) && selectedActions.includes(parsed.action)
}

function quickBooksSetupInstructions(entityLabel: string, includeActionSelection = true): string {
  const instructions = [
    'Connect the <strong>QuickBooks account</strong> whose company should receive these events. Its OAuth connection must use the Client ID, client secret, environment, and webhook verifier token from the same Intuit app.',
    ...(includeActionSelection
      ? [`Select the <strong>${entityLabel}</strong> actions this workflow should handle.`]
      : []),
    '<strong>Deploy</strong> the workflow once to generate the app-level <strong>Webhook URL</strong>.',
    'In the matching Sandbox or Production <strong>Webhooks</strong> settings of your Intuit app, paste the generated URL, enable the <strong>CloudEvents</strong> payload format, select the required entities and actions, and save.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

export function buildQuickBooksTriggerSubBlocks(
  triggerId: string,
  includeDropdown = false
): SubBlockConfig[] {
  const definition = getQuickBooksTriggerDefinition(triggerId)
  if (!definition) throw new Error(`Unknown QuickBooks trigger: ${triggerId}`)

  return buildQuickBooksTriggerEditorSubBlocks({
    definition,
    includeDropdown,
    includeActionSelection: true,
  })
}

export function buildQuickBooksSingleEventTriggerSubBlocks(triggerId: string): SubBlockConfig[] {
  const definition = getQuickBooksTriggerDefinition(triggerId)
  if (!definition) throw new Error(`Unknown QuickBooks trigger: ${triggerId}`)

  return buildQuickBooksTriggerEditorSubBlocks({
    definition,
    includeDropdown: false,
    includeActionSelection: false,
  })
}

interface QuickBooksTriggerEditorOptions {
  definition: QuickBooksTriggerDefinition
  includeDropdown: boolean
  includeActionSelection: boolean
}

function buildQuickBooksTriggerEditorSubBlocks({
  definition,
  includeDropdown,
  includeActionSelection,
}: QuickBooksTriggerEditorOptions): SubBlockConfig[] {
  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: quickBooksTriggerOptions,
      value: () => definition.id,
      required: true,
    })
  }

  blocks.push(...buildQuickBooksWebhookIdentitySubBlocks(definition.id))
  blocks.push({
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    providerWebhookUrl: {
      providerPath: 'quickbooks',
      routingKeySubBlockId: 'quickBooksWebhookAppKey',
    },
    placeholder: 'Deploy the workflow once to generate the URL',
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: definition.id },
  })

  if (includeActionSelection) {
    blocks.push({
      id: quickBooksEventTypesSubBlockId(definition.id),
      title: 'Event Types',
      type: 'dropdown',
      multiSelect: true,
      options: definition.actions.map((action) => ({
        label: action.charAt(0).toUpperCase() + action.slice(1),
        id: action,
      })),
      mode: 'trigger',
      required: true,
      condition: { field: 'selectedTriggerId', value: definition.id },
    })
  }

  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: quickBooksSetupInstructions(definition.label, includeActionSelection),
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: definition.id },
  })

  return blocks
}

function buildQuickBooksWebhookIdentitySubBlocks(triggerId: string): SubBlockConfig[] {
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
      id: 'quickBooksWebhookAppKey',
      title: 'QuickBooks Webhook App Key',
      type: 'short-input',
      hidden: true,
      hideFromCopilot: true,
      mode: 'trigger',
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

function createQuickBooksTrigger(triggerId: string, includeDropdown = false): TriggerConfig {
  const definition = getQuickBooksTriggerDefinition(triggerId)
  if (!definition) throw new Error(`Unknown QuickBooks trigger: ${triggerId}`)
  const isPreferencesUpdate = triggerId === 'quickbooks_preferences_updated'

  return {
    id: triggerId,
    name: `QuickBooks ${definition.label}`,
    provider: 'quickbooks',
    description: isPreferencesUpdate
      ? 'Trigger when QuickBooks Preferences are updated'
      : `Trigger when selected ${definition.label.replace(/ Events$/, '')} events occur in QuickBooks`,
    version: '1.0.0',
    icon: QuickBooksIcon,
    subBlocks: isPreferencesUpdate
      ? buildQuickBooksSingleEventTriggerSubBlocks(triggerId)
      : buildQuickBooksTriggerSubBlocks(triggerId, includeDropdown),
    outputs: buildQuickBooksTriggerOutputs(),
    webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
  }
}

export const quickBooksInvoiceEventsTrigger = createQuickBooksTrigger(
  'quickbooks_invoice_events',
  true
)
export const quickBooksCustomerEventsTrigger = createQuickBooksTrigger('quickbooks_customer_events')
export const quickBooksEstimateEventsTrigger = createQuickBooksTrigger('quickbooks_estimate_events')
export const quickBooksPaymentEventsTrigger = createQuickBooksTrigger('quickbooks_payment_events')
export const quickBooksCreditMemoEventsTrigger = createQuickBooksTrigger(
  'quickbooks_credit_memo_events'
)
export const quickBooksRefundReceiptEventsTrigger = createQuickBooksTrigger(
  'quickbooks_refund_receipt_events'
)
export const quickBooksSalesReceiptEventsTrigger = createQuickBooksTrigger(
  'quickbooks_sales_receipt_events'
)
export const quickBooksVendorEventsTrigger = createQuickBooksTrigger('quickbooks_vendor_events')
export const quickBooksBillEventsTrigger = createQuickBooksTrigger('quickbooks_bill_events')
export const quickBooksBillPaymentEventsTrigger = createQuickBooksTrigger(
  'quickbooks_bill_payment_events'
)
export const quickBooksPurchaseOrderEventsTrigger = createQuickBooksTrigger(
  'quickbooks_purchase_order_events'
)
export const quickBooksPurchaseEventsTrigger = createQuickBooksTrigger('quickbooks_purchase_events')
export const quickBooksVendorCreditEventsTrigger = createQuickBooksTrigger(
  'quickbooks_vendor_credit_events'
)
export const quickBooksDepositEventsTrigger = createQuickBooksTrigger('quickbooks_deposit_events')
export const quickBooksJournalEntryEventsTrigger = createQuickBooksTrigger(
  'quickbooks_journal_entry_events'
)
export const quickBooksTransferEventsTrigger = createQuickBooksTrigger('quickbooks_transfer_events')
export const quickBooksItemEventsTrigger = createQuickBooksTrigger('quickbooks_item_events')
export const quickBooksEmployeeEventsTrigger = createQuickBooksTrigger('quickbooks_employee_events')
export const quickBooksTimeActivityEventsTrigger = createQuickBooksTrigger(
  'quickbooks_time_activity_events'
)
export const quickBooksAccountEventsTrigger = createQuickBooksTrigger('quickbooks_account_events')
export const quickBooksBudgetEventsTrigger = createQuickBooksTrigger('quickbooks_budget_events')
export const quickBooksClassEventsTrigger = createQuickBooksTrigger('quickbooks_class_events')
export const quickBooksCurrencyEventsTrigger = createQuickBooksTrigger('quickbooks_currency_events')
export const quickBooksDepartmentEventsTrigger = createQuickBooksTrigger(
  'quickbooks_department_events'
)
export const quickBooksJournalCodeEventsTrigger = createQuickBooksTrigger(
  'quickbooks_journal_code_events'
)
export const quickBooksPaymentMethodEventsTrigger = createQuickBooksTrigger(
  'quickbooks_payment_method_events'
)
export const quickBooksPreferencesUpdatedTrigger = createQuickBooksTrigger(
  'quickbooks_preferences_updated'
)
export const quickBooksTaxAgencyEventsTrigger = createQuickBooksTrigger(
  'quickbooks_tax_agency_events'
)
export const quickBooksTermEventsTrigger = createQuickBooksTrigger('quickbooks_term_events')
