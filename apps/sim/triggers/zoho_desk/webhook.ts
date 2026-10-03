import { ZohoDeskIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Zoho Desk event types that support a programmatic webhook subscription.
 * Restricted to events documented in Zoho's webhook subscriptions schema.
 */
const ZOHO_DESK_EVENT_OPTIONS = [
  { label: 'Ticket Created', id: 'Ticket_Add' },
  { label: 'Ticket Updated', id: 'Ticket_Update' },
  { label: 'Ticket Deleted', id: 'Ticket_Delete' },
  { label: 'Ticket Comment Added', id: 'Ticket_Comment_Add' },
  { label: 'Ticket Comment Updated', id: 'Ticket_Comment_Update' },
  { label: 'Ticket Thread Added', id: 'Ticket_Thread_Add' },
  { label: 'Contact Created', id: 'Contact_Add' },
  { label: 'Contact Updated', id: 'Contact_Update' },
  { label: 'Contact Deleted', id: 'Contact_Delete' },
  { label: 'Agent Created', id: 'Agent_Add' },
  { label: 'Agent Updated', id: 'Agent_Update' },
  { label: 'Agent Deleted', id: 'Agent_Delete' },
  { label: 'Task Created', id: 'Task_Add' },
  { label: 'Task Updated', id: 'Task_Update' },
  { label: 'Task Deleted', id: 'Task_Delete' },
  { label: 'Article Created', id: 'Article_Add' },
  { label: 'Article Updated', id: 'Article_Update' },
  { label: 'Article Deleted', id: 'Article_Delete' },
]

const ZOHO_DESK_SETUP_INSTRUCTIONS = [
  'Connect your Zoho Desk account above with OAuth — the trigger provisions its webhook through an OAuth connection and cannot use a Self Client. Webhooks require a Zoho Desk edition of Professional or higher (Free and Standard cannot create webhooks). The OAuth connection supports accounts in the US data center (accounts.zoho.com) only, so organizations in other regions cannot use this trigger yet.',
  'Select your Organization from the dropdown (populated automatically from your connected Zoho Desk account).',
  'Choose the event to subscribe to. For "Ticket Updated" you can optionally list up to 5 ticket field API names to watch; previous field values are included in the payload. For "Ticket Thread Added" you can filter by direction (incoming/outgoing).',
  'Optionally restrict events to specific departments by entering comma-separated department IDs.',
  'Click Save above. Sim creates the webhook subscription in Zoho Desk for you and tears it down automatically when the workflow is undeployed.',
]
  .map(
    (instruction, index) => `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
  )
  .join('')

export const zohoDeskWebhookTrigger: TriggerConfig = {
  id: 'zoho_desk',
  name: 'Zoho Desk Event',
  provider: 'zoho_desk',
  description:
    'Trigger a workflow when a Zoho Desk event occurs (ticket, comment, thread, contact, agent, task, or article changes).',
  version: '1.0.0',
  icon: ZohoDeskIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Zoho Desk Account',
      type: 'oauth-input',
      description:
        'This trigger creates and manages a webhook subscription in your Zoho Desk account.',
      serviceId: 'zoho-desk',
      requiredScopes: getScopesForService('zoho-desk'),
      required: true,
      mode: 'trigger',
      // Maps the trigger's credential onto the `oauthCredential` canonical id so
      // the organization selector below resolves it into its SelectorContext.
      canonicalParamId: 'oauthCredential',
    },
    {
      // Intentionally the SAME id as the block's tool-mode `orgId` (unlike
      // `triggerDepartmentIds` below). An organization is the portal the whole
      // block talks to and means exactly the same thing in either mode, so one
      // shared value is the correct behavior — switching the block between tool
      // and trigger mode keeps the portal the user already picked.
      //
      // The platform supports it: `buildCanonicalIndex` dedupes the repeated id
      // and refuses to let a `trigger`-mode subblock overwrite a basicId claimed
      // by a non-trigger one, and `isSubBlockVisibleForTriggerMode` renders only
      // the active mode's twin, so the field never appears twice.
      //
      // A distinct id here would be actively worse, not merely inconsistent: a
      // separate `triggerManualOrgId` would put two entries in this group's
      // `advancedIds`, and `getCanonicalValues` returns the first non-empty one
      // in array order — so a stale tool-mode `manualOrgId` could silently
      // supply the trigger's organization.
      id: 'orgId',
      title: 'Organization',
      type: 'project-selector',
      placeholder: 'Select an organization',
      description: 'The Zoho Desk organization (portal) to subscribe in.',
      canonicalParamId: 'orgId',
      serviceId: 'zoho-desk',
      selectorKey: 'zoho_desk.organizations',
      dependsOn: ['triggerCredentials'],
      required: true,
      mode: 'trigger',
    },
    {
      // Deliberately REUSES the block's `manualOrgId` id rather than introducing
      // a `triggerManualOrgId`. An organization id means the same thing in tool
      // and trigger mode, and `buildCanonicalIndex` dedupes a repeated advanced
      // id across the block/trigger spread — so sharing yields one advanced
      // member for the `orgId` canonical group. A distinct id would instead
      // produce advancedIds `['manualOrgId', 'triggerManualOrgId']`, and
      // `getCanonicalValues` takes the first non-empty member, which would let a
      // tool-mode value stand in for the trigger's organization.
      id: 'manualOrgId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Enter organization ID',
      description: 'Type an organization ID instead of picking one from the list.',
      canonicalParamId: 'orgId',
      required: true,
      mode: 'trigger-advanced',
    },
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      options: ZOHO_DESK_EVENT_OPTIONS,
      value: () => 'Ticket_Add',
      required: true,
      mode: 'trigger',
    },
    {
      // NOTE: distinct from the block's tool-mode `departmentIds` filter.
      // `block.subBlocks` is keyed by id, so a shared id would let a value typed
      // as a list_tickets filter silently become the webhook's department filter
      // (and vice versa) when the block is switched between tool and trigger mode.
      id: 'triggerDepartmentIds',
      title: 'Department IDs (optional)',
      type: 'short-input',
      placeholder: 'Comma-separated department IDs',
      description: 'Restrict events to these departments. Leave empty for all departments.',
      condition: {
        field: 'eventType',
        value: [
          'Ticket_Add',
          'Ticket_Update',
          'Ticket_Comment_Add',
          'Ticket_Comment_Update',
          'Ticket_Thread_Add',
          'Task_Add',
          'Task_Update',
        ],
      },
      mode: 'trigger',
    },
    {
      id: 'fields',
      title: 'Watched Fields (optional)',
      type: 'short-input',
      placeholder: 'Up to 5 comma-separated field API names',
      description:
        'For Ticket Updated: only fire when one of these fields changes (max 5). Previous values are included in the payload.',
      condition: { field: 'eventType', value: 'Ticket_Update' },
      mode: 'trigger',
    },
    {
      id: 'direction',
      title: 'Thread Direction',
      type: 'dropdown',
      options: [
        { label: 'Both', id: 'both' },
        { label: 'Incoming', id: 'in' },
        { label: 'Outgoing', id: 'out' },
      ],
      value: () => 'both',
      condition: { field: 'eventType', value: 'Ticket_Thread_Add' },
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: ZOHO_DESK_SETUP_INSTRUCTIONS,
      mode: 'trigger',
    },
  ],

  outputs: {
    eventType: { type: 'string', description: 'The Zoho Desk event type (e.g. Ticket_Add)' },
    eventTime: { type: 'string', description: 'Event time in milliseconds since epoch' },
    orgId: { type: 'string', description: 'Zoho Desk organization ID' },
    payload: {
      type: 'json',
      description:
        'The full resource that changed (ticket, comment, thread, etc.). Comment and thread events gain a derived plain-text `contentText` alongside the raw `content` + `contentType`; ticket events gain `descriptionText` alongside `description`.',
    },
    prevState: { type: 'json', description: 'Previous state of the resource (update events only)' },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
