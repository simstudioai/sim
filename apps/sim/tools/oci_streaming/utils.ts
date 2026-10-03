import type { ToolConfig } from '@/tools/types'

export const OCI_STREAMING_AUTH_PARAMS = {
  ociCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description:
      'Reusable OCI API signing-key service account. Private keys stay in the foundation.',
  },
  ociRegion: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional OCI region override; defaults to the credential region.',
  },
  requestId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional Oracle request identifier, up to 255 printable characters.',
  },
} satisfies ToolConfig['params']
