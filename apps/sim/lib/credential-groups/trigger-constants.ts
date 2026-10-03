export const CREDENTIAL_GROUP_TRIGGER_PROVIDER = 'credential-group'

export const CREDENTIAL_GROUP_EVENT_TRIGGER_ID = 'credential_group_event'

export const CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES = [
  'credential_added',
  'credential_reconnected',
  'form_submitted',
] as const

export type CredentialGroupTriggerEventType = (typeof CREDENTIAL_GROUP_TRIGGER_EVENT_TYPES)[number]

export const CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES = [
  'credential_added',
  'credential_reconnected',
] as const satisfies readonly CredentialGroupTriggerEventType[]
