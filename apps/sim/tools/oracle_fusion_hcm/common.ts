import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { OAuthConfig, ToolConfig } from '@/tools/types'

export const credentials = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only' as const,
    description: 'Oracle Fusion integration-user credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden' as const,
    description: 'Opaque Basic credential injected by the executor',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden' as const,
    description: 'Oracle Fusion application origin injected by the executor',
  },
} satisfies ToolConfig['params']

export const oauth: OAuthConfig = {
  required: true,
  provider: 'oracle_fusion_hcm',
  requiredScopes: [],
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
}
export const page = {
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm' as const,
    description: 'Records to return (default 20, maximum 100)',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm' as const,
    description: 'Zero-based record offset',
  },
}
export const search = {
  search: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as const,
    description: 'Search text, up to 200 characters',
  },
}
export const effectiveDate = {
  effectiveDate: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as const,
    description: 'Effective date in YYYY-MM-DD format',
  },
}
export const personId = {
  personId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as const,
    description: 'Oracle person ID as a positive decimal string',
  },
}
export const assignmentId = {
  assignmentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as const,
    description: 'Oracle assignment ID as a positive decimal string',
  },
}
export const internalExecution = {
  version: '1.0.0',
  oauth,
  operation: { input: createInternalToolOperationInput },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) throw new Error('Oracle Fusion HCM request failed')
    return data
  },
}

export const common = credentials
export const listCommon = { ...credentials, ...page }
export const searchable = { ...credentials, ...search, ...effectiveDate, ...page }

export const elementEntryValueItems = {
  type: 'object',
  required: ['inputValueId', 'screenEntryValue'],
  additionalProperties: false,
  properties: {
    inputValueId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', description: 'Exact positive int64 input value ID' },
    screenEntryValue: { anyOf: [{ type: 'string', maxLength: 60 }, { type: 'null' }] },
  },
} as const

export const timeAttributeItems = {
  type: 'object',
  required: ['attributeName', 'attributeValue'],
  additionalProperties: false,
  properties: {
    attributeName: { type: 'string', minLength: 1, maxLength: 240 },
    attributeValue: { type: 'string', maxLength: 150 },
  },
} as const

export const finderBindingItems = {
  type: 'object',
  required: ['name', 'value'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$', maxLength: 80 },
    value: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const
