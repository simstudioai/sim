import type {
  OnePasswordResolveSecretParams,
  OnePasswordResolveSecretResponse,
} from '@/tools/onepassword/types'
import type { ToolConfig } from '@/tools/types'

export const resolveSecretTool: ToolConfig<
  OnePasswordResolveSecretParams,
  OnePasswordResolveSecretResponse
> = {
  id: 'onepassword_resolve_secret',
  name: '1Password Resolve Secret',
  description:
    'Resolve a secret reference (op://vault/item/field) to its value. Service Account mode only.',
  version: '1.0.0',

  params: {
    connectionMode: {
      type: 'string',
      required: false,
      description: 'Connection mode: must be "service_account" for this operation',
    },
    serviceAccountToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: '1Password Service Account token',
    },
    secretReference: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Secret reference URI (e.g., op://vault-name/item-name/field-name or op://vault-name/item-name/section-name/field-name)',
    },
  },

  request: {
    url: '/api/tools/onepassword/resolve-secret',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      connectionMode: params.connectionMode ?? 'service_account',
      serviceAccountToken: params.serviceAccountToken,
      secretReference: params.secretReference,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.error) {
      return { success: false, output: { secret: '', reference: '' }, error: data.error }
    }
    return {
      success: true,
      output: {
        secret: data.secret ?? '',
        reference: data.reference ?? '',
      },
    }
  },

  outputs: {
    secret: { type: 'string', description: 'The resolved secret value' },
    reference: { type: 'string', description: 'The original secret reference URI' },
  },
}
