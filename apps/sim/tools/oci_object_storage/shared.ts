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
  params: T,
  fields: readonly (keyof T)[]
) {
  const { accessToken } = params as T & {
    accessToken?: string
  }
  const input: Record<string, unknown> = { credentialId: accessToken ?? '' }
  for (const field of fields) {
    if (params[field] !== undefined) input[String(field)] = params[field]
  }
  return input
}

export const ociObjectStorageOAuth = {
  required: true,
  provider: 'oci_object_storage',
  credentialKind: 'service-account',
} as const
