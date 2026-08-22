import { CredentialIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

interface CredentialBlockOutput {
  success: boolean
  output: {
    credentialId: string
    displayName: string
    providerId: string
    credentials: Array<{
      credentialId: string
      displayName: string
      providerId: string
    }>
    count: number
  }
}

export const CredentialBlock: BlockConfig<CredentialBlockOutput> = {
  type: 'credential',
  name: 'Credential',
  description: 'Select or list OAuth credentials',
  longDescription:
    'Select an OAuth credential once and pipe its ID into any downstream block that requires authentication, or list all OAuth credentials in the workspace for iteration. No secrets are ever exposed — only credential IDs and metadata.',
  bestPractices: `
  - Use "Select Credential" to define an OAuth credential once and reference <CredentialBlock.credentialId> in multiple downstream blocks instead of repeating credential IDs.
  - Use "List Credentials" with a ForEach loop to iterate over all OAuth accounts (e.g. all Gmail accounts).
  - Use the Provider filter to narrow results to specific services (e.g. Gmail, Slack).
  - The outputs are credential ID references, not secret values — they are safe to log and inspect.
  - To switch credentials across environments, replace the single Credential block rather than updating every downstream block.
  `,
  docsLink: 'https://docs.sim.ai/workflows/blocks/credential',
  bgColor: '#6366F1',
  icon: CredentialIcon,
  canvasPresentation: {
    defaultTitle: 'Credential',
    sentences: {
      byOperation: {
        select: ['Select an OAuth credential'],
        list: ['List OAuth credentials', { text: 'for', field: 'providerFilter' }],
      },
    },
  },
  category: 'blocks',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Select Credential', id: 'select' },
        { label: 'List Credentials', id: 'list' },
      ],
      value: () => 'select',
    },
    {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      selectorKey: 'workspace.credentialProviders',
      multiSelect: true,
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'credential',
      title: 'Credential',
      type: 'oauth-input',
      required: { field: 'operation', value: 'select' },
      mode: 'basic',
      placeholder: 'Select a credential',
      canonicalParamId: 'credentialId',
      condition: { field: 'operation', value: 'select' },
    },
    {
      id: 'manualCredential',
      title: 'Credential ID',
      type: 'short-input',
      required: { field: 'operation', value: 'select' },
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      canonicalParamId: 'credentialId',
      condition: { field: 'operation', value: 'select' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    operation: { type: 'string', description: "'select' or 'list'" },
    credentialId: {
      type: 'string',
      description: 'The OAuth credential ID to resolve (select operation)',
    },
    providerFilter: {
      type: 'json',
      description:
        'Array of OAuth provider IDs to filter by (e.g. ["google-email", "slack"]). Leave empty to return all OAuth credentials.',
    },
  },
  outputs: {
    credentialId: {
      type: 'string',
      description: "Credential ID — pipe into other blocks' credential fields",
      condition: { field: 'operation', value: 'select' },
    },
    displayName: {
      type: 'string',
      description: 'Human-readable name of the credential',
      condition: { field: 'operation', value: 'select' },
    },
    providerId: {
      type: 'string',
      description: 'OAuth provider ID (e.g. google-email, slack)',
      condition: { field: 'operation', value: 'select' },
    },
    credentials: {
      type: 'json',
      description:
        'Array of OAuth credential objects, each with credentialId, displayName, and providerId',
      condition: { field: 'operation', value: 'list' },
    },
    count: {
      type: 'number',
      description: 'Number of credentials returned',
      condition: { field: 'operation', value: 'list' },
    },
  },
}
