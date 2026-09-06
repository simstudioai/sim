import type { ToolConfig } from '@/tools/types'

export const oraclePcmOAuth = {
  required: true,
  provider: 'oracle-epm-profitability',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const

export const oraclePcmAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle EPM service-account credential for a PCM environment',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic authentication token injected from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'REST base URL injected from the selected credential',
  },
} satisfies ToolConfig['params']

/** Coerces only resolved booleans, preserving omission and rejecting ambiguous values. */
export function parseOraclePcmBoolean(value: unknown): unknown {
  if (value === '' || value === undefined || value === null) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}
