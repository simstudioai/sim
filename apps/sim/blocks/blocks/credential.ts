import { CredentialIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

interface CredentialBlockOutput {
  success: boolean
  output: {
    credentialId: string
    displayName: string
    type: string
    providerId: string
  }
}

export const CredentialBlock: BlockConfig<CredentialBlockOutput> = {
  type: 'credential',
  name: 'Credential',
  description: 'Reference a stored credential',
  longDescription:
    'Select a stored credential once and pipe its ID into any downstream block that requires authentication. The credential is resolved securely at execution time — no secrets are exposed in the workflow.',
  bestPractices: `
  - Use this block to define a credential once and reference <CredentialBlock.credentialId> in multiple downstream blocks instead of repeating credential IDs.
  - Pipe <CredentialBlock.credentialId> into a downstream block's credential field (advanced mode) to share one credential across many blocks.
  - The output is a credential ID reference, not a secret value — it is safe to log and inspect.
  - To switch credentials across environments, replace the single Credential block rather than updating every downstream block.
  `,
  docsLink: 'https://docs.sim.ai/blocks/credential',
  bgColor: '#6366F1',
  icon: CredentialIcon,
  category: 'blocks',
  subBlocks: [
    {
      id: 'credential',
      title: 'Credential',
      type: 'oauth-input',
      required: true,
      mode: 'basic',
      placeholder: 'Select a credential',
      canonicalParamId: 'credentialId',
    },
    {
      id: 'manualCredential',
      title: 'Credential ID',
      type: 'short-input',
      required: true,
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      canonicalParamId: 'credentialId',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    credentialId: { type: 'string', description: 'The credential ID to resolve' },
  },
  outputs: {
    credentialId: {
      type: 'string',
      description: "Credential ID — pipe into other blocks' credential fields",
    },
    displayName: { type: 'string', description: 'Human-readable name of the credential' },
    type: {
      type: 'string',
      description: 'Credential type: oauth | env_workspace | env_personal | service_account',
    },
    providerId: {
      type: 'string',
      description: 'OAuth provider ID (e.g. google, github), empty for non-OAuth credentials',
    },
  },
}
