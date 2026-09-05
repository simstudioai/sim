import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { OAuthConfig, ToolConfig } from '@/tools/types'

export const credentials = {
  oauthCredential: {
    type: 'string', required: true, visibility: 'user-only',
    description: 'Saved Oracle Fusion integration-user credential',
  },
  accessToken: {
    type: 'string', required: false, visibility: 'hidden',
    description: 'Opaque Basic credential injected by the executor',
  },
  instanceUrl: {
    type: 'string', required: false, visibility: 'hidden',
    description: 'Authoritative Oracle Fusion application origin injected by the executor',
  },
} satisfies ToolConfig['params']

const oauth: OAuthConfig = {
  required: true,
  provider: 'oracle_fusion_recruiting',
  requiredScopes: [],
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
}
export const internalExecution = {
  version: '1.0.0',
  oauth,
  operation: { input: createInternalToolOperationInput },
}
export const page = {
  limit: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Records to return (default 20, maximum 100)' },
  offset: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Zero-based record offset' },
} satisfies ToolConfig['params']
export const search = {
  search: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Search text, up to 200 characters' },
} satisfies ToolConfig['params']
