import { GridOffset } from '@sim/emcn/icons'
import {
  CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES,
  CREDENTIAL_GROUP_EVENT_TRIGGER_ID,
  CREDENTIAL_GROUP_TRIGGER_PROVIDER,
} from '@/lib/credential-groups/trigger-constants'
import type { TriggerConfig } from '@/triggers/types'

export const credentialGroupEventTrigger: TriggerConfig = {
  id: CREDENTIAL_GROUP_EVENT_TRIGGER_ID,
  name: 'Credential Group Event',
  provider: CREDENTIAL_GROUP_TRIGGER_PROVIDER,
  description:
    'Triggers when a credential is added or reconnected, or when a Credential Group form is submitted',
  version: '1.0.0',
  icon: GridOffset,

  subBlocks: [
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      options: [
        { id: 'credential_added', label: 'Credential Added' },
        { id: 'credential_reconnected', label: 'Credential Reconnected' },
        { id: 'form_submitted', label: 'Credential Group Form Submitted' },
      ],
      defaultValue: 'credential_added',
      description: 'The Credential Group event to trigger on.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'credentialGroup',
      title: 'Credential Group',
      type: 'dropdown',
      selectorKey: 'workspace.credentialGroups',
      placeholder: 'Select a Credential Group',
      description: 'The Credential Group to monitor.',
      required: true,
      mode: 'trigger',
      canonicalParamId: 'credentialGroupId',
    },
    {
      id: 'manualCredentialGroup',
      title: 'Credential Group ID',
      type: 'short-input',
      placeholder: 'Enter Credential Group ID',
      description: 'The Credential Group to monitor.',
      required: true,
      mode: 'trigger-advanced',
      canonicalParamId: 'credentialGroupId',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Select the Credential Group to monitor',
        'Choose whether to trigger on a new credential, a reconnection, or a submitted form',
        'Grant this workflow access to the Credential Group',
        'Deploy the workflow to start receiving events',
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
    event: {
      type: 'string',
      description: 'The Credential Group event that fired the trigger',
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp in ISO format',
    },
    credentialGroupId: {
      type: 'string',
      description: 'Credential Group ID',
    },
    credentialGroupName: {
      type: 'string',
      description: 'Credential Group name',
    },
    enrollmentId: {
      type: 'string',
      description: 'Credential Group enrollment ID',
    },
    email: {
      type: 'string',
      description: 'Enrollment email address',
    },
    enrollmentStatus: {
      type: 'string',
      description: 'Enrollment status after the event',
    },
    credentialId: {
      type: 'string',
      description: 'Managed credential ID',
      condition: { field: 'eventType', value: [...CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES] },
    },
    credentialGroupOptionId: {
      type: 'string',
      description: 'Credential Group option ID',
      condition: { field: 'eventType', value: [...CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES] },
    },
    provider: {
      type: 'string',
      description: 'Credential Group provider',
      condition: { field: 'eventType', value: [...CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES] },
    },
    providerId: {
      type: 'string',
      description: 'OAuth provider ID for the managed credential',
      condition: { field: 'eventType', value: [...CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES] },
    },
    displayName: {
      type: 'string',
      description: 'Display name of the connected account',
      condition: { field: 'eventType', value: [...CREDENTIAL_GROUP_CREDENTIAL_EVENT_TYPES] },
    },
  },
}
