import { KetchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { KetchResponse } from '@/tools/ketch/types'

export const KetchBlock: BlockConfig<KetchResponse> = {
  type: 'ketch',
  name: 'Ketch',
  description: 'Manage privacy consent, subscriptions, and data subject rights',
  longDescription:
    'Integrate Ketch into the workflow. Retrieve and update consent preferences, manage subscription topics and controls, and submit data subject rights requests for access, deletion, correction, or processing restriction.',
  docsLink: 'https://docs.sim.ai/tools/ketch',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['identity'],
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
