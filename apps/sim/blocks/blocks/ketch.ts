import { KetchIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { KetchResponse } from '@/tools/ketch/types'

export const KetchBlock: BlockConfig<KetchResponse> = {
  type: 'ketch',
  name: 'Ketch',
  description: 'Manage privacy consent, subscriptions, and data subject rights',
  longDescription:
    'Integrate Ketch into the workflow. Retrieve and update consent preferences, manage subscription topics and controls, and submit data subject rights requests for access, deletion, correction, or processing restriction.',
  docsLink: 'https://docs.sim.ai/integrations/ketch',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#9B5CFF',
  icon: KetchIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Consent', id: 'get_consent' },
        { label: 'Set Consent', id: 'set_consent' },
        { label: 'Get Subscriptions', id: 'get_subscriptions' },
        { label: 'Set Subscriptions', id: 'set_subscriptions' },
        { label: 'Invoke Right', id: 'invoke_right' },
      ],
      value: () => 'get_consent',
    },
    {
      id: 'organizationCode',
      title: 'Organization Code',
      type: 'short-input',
      placeholder: 'Enter your Ketch organization code',
      required: true,
    },
    {
      id: 'propertyCode',
      title: 'Property Code',
      type: 'short-input',
      placeholder: 'Enter the digital property code',
      required: true,
    },
    {
      id: 'environmentCode',
      title: 'Environment Code',
      type: 'short-input',
      placeholder: 'e.g., production',
      required: true,
    },
    {
      id: 'jurisdictionCode',
      title: 'Jurisdiction Code',
      type: 'short-input',
      placeholder: 'e.g., gdpr, ccpa',
      condition: { field: 'operation', value: 'invoke_right' },
      required: { field: 'operation', value: 'invoke_right' },
    },
    {
      id: 'jurisdictionCodeOptional',
      title: 'Jurisdiction Code',
      type: 'short-input',
      placeholder: 'e.g., gdpr, ccpa (optional)',
      condition: { field: 'operation', value: ['get_consent', 'set_consent'] },
      mode: 'advanced',
    },
    {
      id: 'identities',
      title: 'Identities',
      type: 'code',
      placeholder: '{"email": "user@example.com"}',
      language: 'json',
      required: true,
    },
    {
      id: 'purposesFilter',
      title: 'Purposes Filter',
      type: 'code',
      placeholder: '{"analytics": {}, "marketing": {}}',
      language: 'json',
      condition: { field: 'operation', value: 'get_consent' },
      mode: 'advanced',
    },
    {
      id: 'purposes',
      title: 'Purposes',
      type: 'code',
      placeholder:
        '{"analytics": {"allowed": "granted", "legalBasisCode": "consent_optin"}, "marketing": {"allowed": "denied"}}',
      language: 'json',
      condition: { field: 'operation', value: 'set_consent' },
      required: { field: 'operation', value: 'set_consent' },
    },
    {
      id: 'topics',
      title: 'Subscription Topics',
      type: 'code',
      placeholder: '{"newsletter": {"email": {"status": "granted"}, "sms": {"status": "denied"}}}',
      language: 'json',
      condition: { field: 'operation', value: 'set_subscriptions' },
    },
    {
      id: 'controls',
      title: 'Subscription Controls',
      type: 'code',
      placeholder: '{"global_unsubscribe": {"status": "denied"}}',
      language: 'json',
      condition: { field: 'operation', value: 'set_subscriptions' },
    },
    {
      id: 'rightCode',
      title: 'Right Code',
      type: 'dropdown',
      options: [
        { label: 'Access', id: 'access' },
        { label: 'Delete', id: 'delete' },
        { label: 'Correct', id: 'correct' },
        { label: 'Restrict Processing', id: 'restrict_processing' },
      ],
      condition: { field: 'operation', value: 'invoke_right' },
      required: { field: 'operation', value: 'invoke_right' },
    },
    {
      id: 'userData',
      title: 'User Data',
      type: 'code',
      placeholder: '{"email": "user@example.com", "firstName": "John", "lastName": "Doe"}',
      language: 'json',
      condition: { field: 'operation', value: 'invoke_right' },
      mode: 'advanced',
    },
    {
      id: 'collectedAt',
      title: 'Collected At (UNIX timestamp)',
      type: 'short-input',
      placeholder: 'Defaults to current time',
      condition: { field: 'operation', value: 'set_consent' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a UNIX timestamp in seconds for the current time. Return ONLY the numeric timestamp string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
  ],
  tools: {
    access: [
      'ketch_get_consent',
      'ketch_set_consent',
      'ketch_get_subscriptions',
      'ketch_set_subscriptions',
      'ketch_invoke_right',
    ],
    config: {
      tool: (params) => `ketch_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {
          organizationCode: params.organizationCode,
          propertyCode: params.propertyCode,
          environmentCode: params.environmentCode,
        }

        const jurisdictionCode = params.jurisdictionCode || params.jurisdictionCodeOptional
        if (jurisdictionCode) result.jurisdictionCode = jurisdictionCode

        if (params.identities) {
          result.identities =
            typeof params.identities === 'string'
              ? JSON.parse(params.identities)
              : params.identities
        }

        if (params.operation === 'get_consent' && params.purposesFilter) {
          result.purposes =
            typeof params.purposesFilter === 'string'
              ? JSON.parse(params.purposesFilter)
              : params.purposesFilter
        }

        if (params.operation === 'set_consent' && params.purposes) {
          result.purposes =
            typeof params.purposes === 'string' ? JSON.parse(params.purposes) : params.purposes
          if (params.collectedAt) result.collectedAt = Number(params.collectedAt)
        }

        if (params.operation === 'set_subscriptions') {
          if (params.topics) {
            result.topics =
              typeof params.topics === 'string' ? JSON.parse(params.topics) : params.topics
          }
          if (params.controls) {
            result.controls =
              typeof params.controls === 'string' ? JSON.parse(params.controls) : params.controls
          }
        }

        if (params.operation === 'invoke_right') {
          if (params.rightCode) result.rightCode = params.rightCode
          if (params.userData) {
            result.userData =
              typeof params.userData === 'string' ? JSON.parse(params.userData) : params.userData
          }
        }

        return result
      },
    },
  },
  inputs: {
    organizationCode: { type: 'string', description: 'Ketch organization code' },
    propertyCode: { type: 'string', description: 'Digital property code' },
    environmentCode: { type: 'string', description: 'Environment code' },
    jurisdictionCode: { type: 'string', description: 'Jurisdiction code' },
    identities: { type: 'json', description: 'Identity map for the data subject' },
    purposes: { type: 'json', description: 'Consent purposes map' },
    topics: { type: 'json', description: 'Subscription topics map' },
    controls: { type: 'json', description: 'Subscription controls map' },
    rightCode: { type: 'string', description: 'Privacy right code' },
    userData: { type: 'json', description: 'Data subject information' },
    collectedAt: { type: 'number', description: 'UNIX timestamp of consent collection' },
  },
  outputs: {
    purposes: { type: 'json', description: 'Consent status per purpose (allowed, legalBasisCode)' },
    vendors: { type: 'json', description: 'Vendor consent statuses' },
    topics: {
      type: 'json',
      description: 'Subscription topic statuses per contact method',
    },
    controls: { type: 'json', description: 'Subscription control statuses' },
    success: { type: 'boolean', description: 'Whether the request succeeded' },
    message: { type: 'string', description: 'Response message from Ketch' },
  },
}

export const KetchBlockMeta = {
  tags: ['identity'],
  url: 'https://www.ketch.com',
  templates: [
    {
      icon: KetchIcon,
      title: 'Ketch consent propagator',
      prompt:
        'Build a workflow that on a consent change reads the contact’s Ketch consent state and propagates it to downstream systems — HubSpot and Loops — keeping privacy preferences in sync.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['hubspot', 'loops'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch DSR fulfillment',
      prompt:
        'Create a workflow that on a Ketch data subject request collects matching personal data from connected systems, generates the export, and writes the fulfillment audit.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch deletion-request handler',
      prompt:
        'Build a workflow that on a Ketch deletion request propagates the deletion to all connected systems, captures confirmations, and writes the chain of custody.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch consent-drift detector',
      prompt:
        'Create a scheduled workflow that compares Ketch consent state with downstream systems, flags drift, and writes a remediation queue for the privacy team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'monitoring'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch subscription sync',
      prompt:
        'Build a workflow that reads each contact’s Ketch subscription topics and mirrors the opt-in state to the marketing tool so unsubscribe preferences stay consistent across systems.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch right-invocation handler',
      prompt:
        'Create a workflow that on an incoming privacy request invokes the matching Ketch right for the data subject, captures the confirmation, and writes the action to a compliance file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch consent-rate digest',
      prompt:
        'Build a scheduled monthly workflow that samples Ketch consent state across a contact list, computes opt-in rates per purpose, and writes a privacy report file for executive review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'check-user-consent',
      description: 'Look up a user current consent state in Ketch before processing their data.',
      content:
        '# Check User Consent\n\nConfirm what a user has consented to before a workflow uses their data.\n\n## Steps\n1. Identify the user (by identity key) and the jurisdiction/policy scope.\n2. Get the user current consent for the relevant purposes (analytics, marketing, etc.).\n3. Determine which downstream actions are permitted based on the consent state.\n\n## Output\nReturn the consent state per purpose and a clear allow/deny decision for the intended data use. Stop the workflow if required consent is missing.',
    },
    {
      name: 'record-consent-update',
      description: 'Set or update a user consent choices in Ketch from a preference change.',
      content:
        '# Record a Consent Update\n\nPersist a user updated consent choices to Ketch.\n\n## Steps\n1. Capture the user identity and the new consent choices per purpose.\n2. Set the consent for that user in the correct jurisdiction/policy scope.\n3. Read the consent back to confirm it was applied.\n\n## Output\nConfirm the user identity, the purposes updated, and the resulting consent state.',
    },
    {
      name: 'fulfill-data-subject-request',
      description: 'Invoke a data subject right (access, delete) in Ketch and track the request.',
      content:
        '# Fulfill a Data Subject Request\n\nKick off a DSR (e.g. access or deletion) on behalf of a user.\n\n## Steps\n1. Capture the requester identity and the right being exercised (access, deletion, correction).\n2. Invoke the right in Ketch with the required identity and jurisdiction context.\n3. Capture the request reference for tracking.\n\n## Output\nReturn the request reference, the right invoked, and the requester identity so the request can be tracked to completion.',
    },
    {
      name: 'sync-subscription-preferences',
      description:
        'Read a user subscription topics in Ketch and update them to honor an opt-in or opt-out.',
      content:
        '# Sync Subscription Preferences\n\nKeep a user communication preferences accurate in Ketch when they opt in or out of a channel or topic.\n\n## Steps\n1. Identify the user and get their current subscription topics and controls.\n2. Determine the requested change (e.g. opt out of the newsletter, set a global unsubscribe).\n3. Set the subscription topics and controls to the new state for that user.\n4. Read the subscriptions back to confirm the change applied.\n\n## Output\nReturn the topics and controls that changed and the resulting opt-in or opt-out state per channel. Confirm any global unsubscribe was honored.',
    },
  ],
} as const satisfies BlockMeta
