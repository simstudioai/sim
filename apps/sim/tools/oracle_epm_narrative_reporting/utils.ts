import type { OAuthConfig, ToolConfig } from '@/tools/types'

/** Credential-bound service account; caller-supplied destinations never reach the transport. */
export const narrativeOAuth = {
  required: true,
  provider: 'oracle-epm-narrative-reporting',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const narrativeAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle EPM service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Credential token injected by the authorized executor',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description:
      'Environment URL injected from the selected credential; caller values are discarded',
  },
} satisfies ToolConfig['params']
