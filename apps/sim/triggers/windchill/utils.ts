import type { SubBlockConfig } from '@/blocks/types'

export const windchillTriggerOptions = [
  { label: 'Document Attributes Changed', id: 'windchill_document_attributes_changed' },
  { label: 'Document Identity Changed', id: 'windchill_document_identity_changed' },
  {
    label: 'Document Lifecycle State Changed',
    id: 'windchill_document_lifecycle_state_changed',
  },
  { label: 'Custom Document Event', id: 'windchill_custom_document_event' },
]

const WINDCHILL_EVENT_BY_TRIGGER: Record<string, string> = {
  windchill_document_attributes_changed: 'EDIT_ATTRIBUTES',
  windchill_document_identity_changed: 'EDIT_IDENTITY',
  windchill_document_lifecycle_state_changed: 'CHANGE_LIFECYCLE_STATE',
}

export function resolveWindchillEventId(
  triggerId: string | undefined,
  customEvent: string | undefined
): string {
  const eventId = (triggerId ? WINDCHILL_EVENT_BY_TRIGGER[triggerId] : undefined) ?? customEvent
  const trimmed = eventId?.trim()
  if (!trimmed) {
    throw new Error('A Windchill event identifier is required')
  }
  if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(trimmed)) {
    throw new Error('Windchill event identifier contains unsupported characters')
  }
  return trimmed
}

export function windchillSetupInstructions(eventLabel: string): string {
  const instructions = [
    '<strong>Requirement:</strong> This trigger needs a self-managed Windchill deployment with Windchill REST Services 1.4 or later. Windchill+ does not support webhook subscriptions.',
    'Ask a Windchill administrator to set <strong>Webhooks &gt; Outgoing Webhook URL</strong> at the site level to the same host as the generated Sim webhook URL. Windchill allows only one configured outgoing webhook host.',
    'Enter the versioned Windchill service root and credentials for an account allowed to manage Event Management subscriptions.',
    `Choose the document scope for <strong>${eventLabel}</strong>. When you save, Sim creates the Windchill subscription automatically.`,
    'Keep the generated webhook URL private. PTC does not document a webhook signing mechanism, so Sim accepts deliveries through the unique callback URL and passes the JSON body through unchanged.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

function triggerCondition(triggerId: string) {
  return { field: 'selectedTriggerId', value: triggerId }
}

function scopedCondition(triggerId: string, scope: 'document' | 'folder' | 'container') {
  return {
    field: 'selectedTriggerId',
    value: triggerId,
    and: { field: 'triggerScope', value: scope },
  }
}

export function buildWindchillExtraFields(
  triggerId: string,
  options: { lifecycleState?: boolean; customEvent?: boolean } = {}
): SubBlockConfig[] {
  const fields: SubBlockConfig[] = [
    {
      id: 'triggerBaseUrl',
      title: 'Service Root',
      type: 'short-input',
      placeholder: 'https://host/Windchill/servlet/odata/v6',
      description:
        'Complete versioned HTTPS OData service root for a self-managed Windchill deployment',
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: triggerCondition(triggerId),
    },
    {
      id: 'triggerUsername',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Windchill username',
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: triggerCondition(triggerId),
    },
    {
      id: 'triggerPassword',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Windchill password',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: triggerCondition(triggerId),
    },
    {
      id: 'triggerScope',
      title: 'Scope',
      type: 'dropdown',
      options: [
        { label: 'Document', id: 'document' },
        { label: 'Folder', id: 'folder' },
        { label: 'Container', id: 'container' },
      ],
      defaultValue: 'document',
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: triggerCondition(triggerId),
    },
    {
      id: 'triggerDocumentOid',
      title: 'Document OID',
      type: 'short-input',
      placeholder: 'OR:wt.doc.WTDocument:48796581',
      description: 'Subscribe to one WT.Document object',
      required: scopedCondition(triggerId, 'document'),
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: scopedCondition(triggerId, 'document'),
    },
    {
      id: 'triggerSubscribeAllVersions',
      title: 'Subscribe to All Versions',
      type: 'switch',
      description: 'Apply the subscription to current and future versions of the document',
      defaultValue: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: scopedCondition(triggerId, 'document'),
    },
    {
      id: 'triggerFolderOid',
      title: 'Folder OID',
      type: 'short-input',
      placeholder: 'OR:wt.folder.SubFolder:5012381',
      description: 'Subscribe to documents in this folder',
      required: scopedCondition(triggerId, 'folder'),
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: scopedCondition(triggerId, 'folder'),
    },
    {
      id: 'triggerContainerOid',
      title: 'Container OID',
      type: 'short-input',
      placeholder: 'OR:wt.pdmlink.PDMLinkProduct:79638',
      description: 'Subscribe to documents in this product, library, or other container',
      required: scopedCondition(triggerId, 'container'),
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: scopedCondition(triggerId, 'container'),
    },
  ]

  if (options.lifecycleState) {
    fields.push({
      id: 'triggerLifecycleStateValue',
      title: 'Lifecycle State Value',
      type: 'short-input',
      placeholder: 'RELEASED',
      description: 'Internal lifecycle state value that should trigger the workflow',
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: triggerCondition(triggerId),
    })
  }

  if (options.customEvent) {
    fields.push({
      id: 'triggerEvent',
      title: 'Event Identifier',
      type: 'short-input',
      placeholder: 'EDIT_CONTENT',
      description:
        "Exact event identifier returned by EventMgmt/GetApplicableEvents(EntityName='PTC.DocMgmt.Document')",
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: triggerCondition(triggerId),
    })
  }

  return fields
}
