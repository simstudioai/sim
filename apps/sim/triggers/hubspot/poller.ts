import { createLogger } from '@sim/logger'
import { HubspotIcon } from '@/components/icons'
import { requestJson } from '@/lib/api/client/request'
import {
  hubspotListsSelectorContract,
  hubspotOwnersSelectorContract,
  hubspotPipelinesSelectorContract,
  hubspotPropertiesSelectorContract,
} from '@/lib/api/contracts/selectors/hubspot'
import { getScopesForService } from '@/lib/oauth/utils'
import { isCredentialSetValue } from '@/executor/constants'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'

const logger = createLogger('HubSpotPollingTrigger')

/**
 * Resolves the effective object type from the subblock store. `getValue` returns `null`
 * for fields the user hasn't interacted with yet, so we fall back to the dropdown's
 * default ('contact') — otherwise the cascading property selectors render empty on
 * first render even when the dropdown visibly shows "contact".
 */
function resolveSelectedObjectType(blockId: string): string | null {
  const objectType = useSubBlockStore.getState().getValue(blockId, 'objectType') as string | null
  const customId = useSubBlockStore.getState().getValue(blockId, 'customObjectTypeId') as
    | string
    | null
  const selected = objectType ?? 'contact'
  if (selected === 'custom') {
    const trimmed = customId?.trim()
    return trimmed ? trimmed : null
  }
  return selected
}

async function fetchHubSpotProperties(blockId: string, objectType: string) {
  const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
    | string
    | null
  if (!credentialId) throw new Error('No HubSpot credential selected')
  if (isCredentialSetValue(credentialId)) return []
  const data = await requestJson(hubspotPropertiesSelectorContract, {
    query: { credentialId, objectType },
  })
  return data.properties.map((p) => ({ id: p.id, label: p.name }))
}

export const hubspotPollingTrigger: TriggerConfig = {
  id: 'hubspot_poller',
  name: 'HubSpot CRM Trigger',
  provider: 'hubspot',
  description:
    'Triggers when HubSpot CRM records (contacts, companies, deals, tickets, custom objects) are created or updated, or when contacts join a list',
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
      requiredScopes: getScopesForService('hubspot'),
      required: true,
      mode: 'trigger',
      supportsCredentialSets: true,
    },
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      description: 'What you want to watch.',
      options: [
        { label: 'Contact', id: 'contact' },
        { label: 'Company', id: 'company' },
        { label: 'Deal', id: 'deal' },
        { label: 'Ticket', id: 'ticket' },
        { label: 'Custom Object', id: 'custom' },
        { label: 'List Membership', id: 'list_membership' },
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
      required: { field: 'objectType', value: 'custom' },
      mode: 'trigger',
      condition: { field: 'objectType', value: 'custom' },
    },
    {
      id: 'listId',
      title: 'List',
      type: 'dropdown',
      description: 'The HubSpot list to watch for new members.',
      placeholder: 'Select a list',
      options: [],
      fetchOptions: async (blockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) throw new Error('No HubSpot credential selected')
        if (isCredentialSetValue(credentialId)) return []
        try {
          const data = await requestJson(hubspotListsSelectorContract, {
            query: { credentialId },
          })
          return data.lists.map((l) => ({ id: l.id, label: l.name }))
        } catch (error) {
          logger.error('Error fetching HubSpot lists:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials'],
      required: { field: 'objectType', value: 'list_membership' },
      mode: 'trigger',
      condition: { field: 'objectType', value: 'list_membership' },
    },
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      description:
        'Created fires once per new record. Updated fires on any modification. Property Changed fires only when the chosen property changes value.',
      options: [
        { label: 'Created', id: 'created' },
        { label: 'Updated (any change)', id: 'updated' },
        { label: 'Property Changed', id: 'property_changed' },
      ],
      defaultValue: 'created',
      required: { field: 'objectType', value: 'list_membership', not: true },
      mode: 'trigger',
      condition: { field: 'objectType', value: 'list_membership', not: true },
    },
    {
      id: 'targetPropertyName',
      title: 'Property to Watch',
      type: 'dropdown',
      description: 'Fires only when this specific property changes value on a record.',
      placeholder: 'Select a property',
      options: [],
      fetchOptions: async (blockId: string) => {
        const resolved = resolveSelectedObjectType(blockId)
        if (!resolved) throw new Error('Select an object type first')
        try {
          return await fetchHubSpotProperties(blockId, resolved)
        } catch (error) {
          logger.error('Error fetching HubSpot properties:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials', 'objectType', 'customObjectTypeId'],
      required: { field: 'eventType', value: 'property_changed' },
      mode: 'trigger',
      condition: {
        field: 'eventType',
        value: 'property_changed',
        and: { field: 'objectType', value: 'list_membership', not: true },
      },
    },
    {
      id: 'properties',
      title: 'Properties to Fetch',
      type: 'dropdown',
      multiSelect: true,
      description:
        'Properties to include on each record. Leave empty to use sensible defaults. Sim always includes the timestamps it needs internally.',
      placeholder: 'Select properties (optional)',
      options: [],
      fetchOptions: async (blockId: string) => {
        const resolved = resolveSelectedObjectType(blockId)
        if (!resolved) return []
        try {
          return await fetchHubSpotProperties(blockId, resolved)
        } catch (error) {
          logger.error('Error fetching HubSpot properties:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials', 'objectType', 'customObjectTypeId'],
      required: false,
      mode: 'trigger',
      condition: { field: 'objectType', value: 'list_membership', not: true },
    },
    {
      id: 'pipelineId',
      title: 'Pipeline (optional)',
      type: 'dropdown',
      description: 'Restrict to a single pipeline.',
      placeholder: 'All pipelines',
      options: [],
      fetchOptions: async (blockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        const objectType = resolveSelectedObjectType(blockId) ?? 'contact'
        if (!credentialId) throw new Error('No HubSpot credential selected')
        if (isCredentialSetValue(credentialId)) return []
        try {
          const data = await requestJson(hubspotPipelinesSelectorContract, {
            query: { credentialId, objectType },
          })
          return data.pipelines.map((p) => ({ id: p.id, label: p.name }))
        } catch (error) {
          logger.error('Error fetching HubSpot pipelines:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials', 'objectType'],
      required: false,
      mode: 'trigger',
      condition: { field: 'objectType', value: ['deal', 'ticket'] },
    },
    {
      id: 'stageId',
      title: 'Stage (optional)',
      type: 'dropdown',
      description: 'Restrict to a single stage within the selected pipeline.',
      placeholder: 'All stages',
      options: [],
      fetchOptions: async (blockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        const objectType = resolveSelectedObjectType(blockId) ?? 'contact'
        const pipelineId = useSubBlockStore.getState().getValue(blockId, 'pipelineId') as
          | string
          | null
        if (!credentialId) throw new Error('No HubSpot credential selected')
        if (isCredentialSetValue(credentialId)) return []
        if (!pipelineId) return []
        try {
          const data = await requestJson(hubspotPipelinesSelectorContract, {
            query: { credentialId, objectType },
          })
          const pipeline = data.pipelines.find((p) => p.id === pipelineId)
          return (pipeline?.stages ?? []).map((s) => ({ id: s.id, label: s.label }))
        } catch (error) {
          logger.error('Error fetching HubSpot stages:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials', 'objectType', 'pipelineId'],
      required: false,
      mode: 'trigger',
      condition: { field: 'pipelineId', value: '', not: true },
    },
    {
      id: 'ownerId',
      title: 'Owner (optional)',
      type: 'dropdown',
      description: 'Restrict to records owned by a specific HubSpot user.',
      placeholder: 'Any owner',
      options: [],
      fetchOptions: async (blockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) throw new Error('No HubSpot credential selected')
        if (isCredentialSetValue(credentialId)) return []
        try {
          const data = await requestJson(hubspotOwnersSelectorContract, {
            query: { credentialId },
          })
          return data.owners.map((o) => ({ id: o.id, label: o.name }))
        } catch (error) {
          logger.error('Error fetching HubSpot owners:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials'],
      required: false,
      mode: 'trigger',
      condition: { field: 'objectType', value: 'list_membership', not: true },
    },
    {
      id: 'filters',
      title: 'Advanced Filters (optional)',
      type: 'long-input',
      description:
        'JSON array of HubSpot search filters, AND-combined. Each item: {"propertyName":"...","operator":"EQ","value":"..."}. Operators: EQ, NEQ, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN, GT, GTE, LT, LTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY.',
      placeholder:
        '[{"propertyName":"lifecyclestage","operator":"EQ","value":"customer"},{"propertyName":"amount","operator":"GT","value":"10000"}]',
      required: false,
      mode: 'trigger',
      condition: { field: 'objectType', value: 'list_membership', not: true },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert HubSpot CRM developer. Generate a JSON array of HubSpot search filters based on the user's request.

Each filter is { propertyName, operator, value }. Filters are AND-combined. The available operators are: EQ, NEQ, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN, GT, GTE, LT, LTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY.

Dates use millisecond epoch values as strings. Strings are exact (case-sensitive) for EQ/NEQ.

User context:
{context}

Return ONLY the JSON array — no explanations, no markdown, no code fences.`,
        placeholder: 'Describe the records you want…',
        generationType: 'json-object',
      },
    },
    {
      id: 'maxRecordsPerPoll',
      title: 'Max Records Per Poll',
      type: 'short-input',
      description:
        'Soft cap on records emitted per poll (default 50, max 1000). Excess rolls over to the next poll.',
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
        '(Optional) Restrict by pipeline, stage, owner, or advanced filters.',
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
        'HubSpot object type (contact, company, deal, ticket, custom object id, or list_membership)',
    },
    eventType: {
      type: 'string',
      description: 'Event type (created, updated, property_changed, or joined)',
    },
    objectId: {
      type: 'string',
      description: 'HubSpot ID of the affected record (or contact id for list memberships)',
    },
    occurredAt: {
      type: 'string',
      description: 'ISO timestamp of when the change happened in HubSpot',
    },
    properties: {
      type: 'json',
      description:
        'HubSpot properties on the record as a key-value object (property internal name → value). Default keys per object type (override via "Properties to Fetch"): Contact → firstname, lastname, email, phone, company, lifecyclestage, hs_lead_status, hubspot_owner_id, createdate, lastmodifieddate. Company → name, domain, industry, lifecyclestage, hubspot_owner_id, createdate, hs_lastmodifieddate. Deal → dealname, amount, dealstage, pipeline, closedate, hubspot_owner_id, createdate, hs_lastmodifieddate. Ticket → subject, content, hs_pipeline, hs_pipeline_stage, hs_ticket_priority, hubspot_owner_id, createdate, hs_lastmodifieddate. Custom and user-requested properties appear keyed by their HubSpot internal name.',
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
    propertyName: {
      type: 'string',
      description: 'Name of the property that changed (property_changed events only)',
    },
    propertyValue: {
      type: 'string',
      description: 'New value of the changed property (property_changed events only)',
    },
    previousValue: {
      type: 'string',
      description: 'Previous value before the change (property_changed events only)',
    },
    listId: {
      type: 'string',
      description: 'HubSpot list ID (list_membership events only)',
    },
    timestamp: {
      type: 'string',
      description: 'ISO timestamp when Sim emitted the event',
    },
  },
}
