import { CredentialIcon } from '@/components/icons'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { BlockConfig } from '@/blocks/types'
import { fetchWorkspaceCredentialList, workspaceCredentialKeys } from '@/hooks/queries/credentials'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface CredentialBlockOutput {
  success: boolean
  output: {
    credentialId: string
    displayName: string
    type: string
    providerId: string
    credentials: Array<{
      credentialId: string
      displayName: string
      type: string
      providerId: string
    }>
    count: number
  }
}

export const CredentialBlock: BlockConfig<CredentialBlockOutput> = {
  type: 'credential',
  name: 'Credential',
  description: 'Select or list stored credentials',
  longDescription:
    'Select a stored credential once and pipe its ID into any downstream block that requires authentication, or list all credentials in the workspace for iteration. No secrets are ever exposed — only credential IDs and metadata.',
  bestPractices: `
  - Use "Select Credential" to define a credential once and reference <CredentialBlock.credentialId> in multiple downstream blocks instead of repeating credential IDs.
  - Use "List Credentials" with a ForEach loop to iterate over all credentials of a given type (e.g. all OAuth accounts).
  - Use the Type Filter in "List Credentials" to narrow results to a specific credential type.
  - Use the Provider filter to further narrow OAuth results to specific services (e.g. Gmail, Slack).
  - The outputs are credential ID references, not secret values — they are safe to log and inspect.
  - To switch credentials across environments, replace the single Credential block rather than updating every downstream block.
  `,
  docsLink: 'https://docs.sim.ai/blocks/credential',
  bgColor: '#6366F1',
  icon: CredentialIcon,
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
      id: 'typeFilter',
      title: 'Type Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'OAuth', id: 'oauth' },
        { label: 'Env Variables (Workspace)', id: 'env_workspace' },
        { label: 'Env Variables (Personal)', id: 'env_personal' },
        { label: 'Service Accounts', id: 'service_account' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'providerFilter',
      title: 'Provider',
      type: 'dropdown',
      multiSelect: true,
      options: [],
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
      condition: {
        field: 'operation',
        value: 'list',
        and: { field: 'typeFilter', value: 'oauth' },
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
      description: 'The credential ID to resolve (select operation)',
    },
    typeFilter: {
      type: 'string',
      description:
        "Type filter for list operation: 'all' | 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'",
    },
    providerFilter: {
      type: 'json',
      description:
        'Array of OAuth provider IDs to filter by (e.g. ["google-email", "slack"]). Only applies when typeFilter is oauth.',
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
    type: {
      type: 'string',
      description: 'Credential type: oauth | env_workspace | env_personal | service_account',
      condition: { field: 'operation', value: 'select' },
    },
    providerId: {
      type: 'string',
      description: 'OAuth provider ID (e.g. google, github), empty for non-OAuth credentials',
      condition: { field: 'operation', value: 'select' },
    },
    credentials: {
      type: 'json',
      description:
        'Array of credential objects, each with credentialId, displayName, type, and providerId',
      condition: { field: 'operation', value: 'list' },
    },
    count: {
      type: 'number',
      description: 'Number of credentials returned',
      condition: { field: 'operation', value: 'list' },
    },
  },
}
