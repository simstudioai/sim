import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { CredentialBlockDisplay } from '@/blocks/blocks/credential.display'
import type { BlockConfig } from '@/blocks/types'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { fetchWorkspaceCredentialList } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  ...CredentialBlockDisplay,
  bestPractices: `
  - Use "Select Credential" to define an OAuth credential once and reference <CredentialBlock.credentialId> in multiple downstream blocks instead of repeating credential IDs.
  - Use "List Credentials" with a ForEach loop to iterate over all OAuth accounts (e.g. all Gmail accounts).
  - Use the Provider filter to narrow results to specific services (e.g. Gmail, Slack).
  - The outputs are credential ID references, not secret values — they are safe to log and inspect.
  - To switch credentials across environments, replace the single Credential block rather than updating every downstream block.
  `,
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
      multiSelect: true,
      options: [],
      condition: { field: 'operation', value: 'list' },
      fetchOptions: async () => {
        const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
        if (!workspaceId) return []

        const credentials = await getQueryClient().fetchQuery({
          queryKey: workspaceCredentialKeys.list(workspaceId),
          queryFn: () => fetchWorkspaceCredentialList(workspaceId),
          staleTime: 60 * 1000,
        })

        const seen = new Set<string>()
        const options: Array<{ label: string; id: string }> = []

        for (const cred of credentials) {
          if (cred.type === 'oauth' && cred.providerId && !seen.has(cred.providerId)) {
            seen.add(cred.providerId)
            const serviceConfig = getServiceConfigByProviderId(cred.providerId)
            options.push({ label: serviceConfig?.name ?? cred.providerId, id: cred.providerId })
          }
        }

        return options.sort((a, b) => a.label.localeCompare(b.label))
      },
      fetchOptionById: async (_blockId: string, optionId: string) => {
        const serviceConfig = getServiceConfigByProviderId(optionId)
        const label = serviceConfig?.name ?? optionId
        return { label, id: optionId }
      },
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
