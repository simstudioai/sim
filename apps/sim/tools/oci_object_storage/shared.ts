import type { ToolConfig } from '@/tools/types'

export const ociObjectStorageAuthParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Connected OCI Object Storage Customer Secret Key credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Server-internal authorized credential reference',
  },
} satisfies ToolConfig['params']

export function createOciObjectStorageOperationInput<T extends { oauthCredential: string }>(
  params: T
): Omit<T, 'oauthCredential' | 'accessToken' | '_context'> & { credentialId: string } {
  const { oauthCredential, accessToken, _context, ...input } = params as T & {
    accessToken?: string
    _context?: unknown
  }
  void oauthCredential
  return { ...input, credentialId: accessToken ?? '' }
}

export const ociObjectStorageOAuth = {
  required: true,
  provider: 'oci_object_storage',
  credentialKind: 'service-account',
} as const
