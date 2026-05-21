import { HubspotIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const hubspotPollingTrigger: TriggerConfig = {
  id: 'hubspot_poller',
  name: 'HubSpot Trigger',
  provider: 'hubspot',
  description:
    'Triggers when a HubSpot record (contact, company, deal, ticket, or custom object) is created or updated',
  version: '1.0.0',
  icon: HubspotIcon,
  polling: true,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'HubSpot Account',
      type: 'oauth-input',
      description: 'Connect a HubSpot account so Sim can poll your CRM on your behalf.',
      serviceId: 'hubspot',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      supportsCredentialSets: true,
    },
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      description:
        'Which HubSpot CRM object to watch. Pick "Custom Object" to poll a user-defined CRM object.',
      options: [
        { label: 'Contact', id: 'contact' },
        { label: 'Company', id: 'company' },
        { label: 'Deal', id: 'deal' },
        { label: 'Ticket', id: 'ticket' },
        { label: 'Custom Object', id: 'custom' },
      ],
      defaultValue: 'contact',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'customObjectTypeId',
      title: 'Custom Object Type ID',
      type: 'short-input',
      description:
        'HubSpot custom object type ID (e.g. "2-12345"). Find it in HubSpot Settings → Objects → Custom Objects.',
      placeholder: '2-12345',
      required: true,
      mode: 'trigger',
      condition: { field: 'objectType', value: 'custom' },
    },
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      description:
        'Created fires once per new record. Updated fires whenever the record changes (and on creation).',
      options: [
        { label: 'Created', id: 'created' },
        { label: 'Updated', id: 'updated' },
      ],
      defaultValue: 'created',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'properties',
      title: 'Properties to Fetch (optional)',
      type: 'long-input',
      description:
        'Comma- or newline-separated list of HubSpot property names to include on each record. Leave empty to use sensible defaults. Sim always includes the timestamp properties Sim needs internally, regardless of this list.',
      placeholder: 'firstname, lastname, email, lifecyclestage, custom_property_1',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'filterPropertyName',
      title: 'Filter Property (optional)',
      type: 'short-input',
      description:
        'Only emit records where this property equals the value below. Leave both fields empty to emit every change.',
      placeholder: 'lifecyclestage',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'filterPropertyValue',
      title: 'Filter Value (optional)',
      type: 'short-input',
      description: 'Value the filter property must match (exact match, case-sensitive).',
      placeholder: 'customer',
      required: false,
      mode: 'trigger',
      condition: { field: 'filterPropertyName', value: '', not: true },
    },
    {
      id: 'maxRecordsPerPoll',
      title: 'Max Records Per Poll',
      type: 'short-input',
      description:
        'Cap on records emitted per poll (default 50, max 1000). Excess rolls over to the next poll.',
      placeholder: '50',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'How it works',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your HubSpot account above.',
        'Pick the object type and event you want to watch.',
        '(Optional) Restrict to specific properties or a filter value.',
        'Sim polls HubSpot every minute and fires this workflow for each new or updated record.',
        'The first poll establishes a baseline — only records changed <em>after</em> activation will fire the workflow.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    objectType: {
      type: 'string',
      description:
        'HubSpot object type that fired the trigger (contact, company, deal, ticket, or custom object type ID)',
    },
    eventType: {
      type: 'string',
      description: 'Event type that fired the trigger (created or updated)',
    },
    objectId: {
      type: 'string',
      description: 'HubSpot ID of the affected record',
    },
    occurredAt: {
      type: 'string',
      description:
        'ISO timestamp of the create or update on the record (sourced from the relevant HubSpot timestamp property)',
    },
    properties: {
      type: 'json',
      description: 'HubSpot properties returned for the record (object of property name to value)',
    },
    createdAt: {
      type: 'string',
      description: 'ISO timestamp when the record was created in HubSpot',
    },
    updatedAt: {
      type: 'string',
      description: 'ISO timestamp when the record was last updated in HubSpot',
    },
    archived: {
      type: 'boolean',
      description: 'Whether the record is archived',
    },
    timestamp: {
      type: 'string',
      description: 'ISO timestamp when Sim emitted the event',
    },
  },
}
