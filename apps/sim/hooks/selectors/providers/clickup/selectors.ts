import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const clickupSelectors = {
  'clickup.workspaces': {
    key: 'clickup.workspaces',
    contracts: [selectorContracts.clickupWorkspacesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'clickup.workspaces',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'clickup.workspaces')
      const data = await requestJson(selectorContracts.clickupWorkspacesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.workspaces || []).map((workspace) => ({
        id: workspace.id,
        label: workspace.name,
      }))
    },
  },
  'clickup.spaces': {
    key: 'clickup.spaces',
    contracts: [selectorContracts.clickupSpacesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'clickup.spaces',
      context.oauthCredential ?? 'none',
      context.teamId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.teamId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'clickup.spaces')
      if (!context.teamId) {
        throw new Error('Missing workspace (team) ID for clickup.spaces selector')
      }
      const data = await requestJson(selectorContracts.clickupSpacesSelectorContract, {
        body: {
          credential: credentialId,
          teamId: context.teamId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.spaces || []).map((space) => ({
        id: space.id,
        label: space.name,
      }))
    },
  },
  'clickup.folders': {
    key: 'clickup.folders',
    contracts: [selectorContracts.clickupFoldersSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'clickup.folders',
      context.oauthCredential ?? 'none',
      context.spaceId ?? context.listSpaceId ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && (context.spaceId || context.listSpaceId)),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'clickup.folders')
      const spaceId = context.spaceId || context.listSpaceId
      if (!spaceId) {
        throw new Error('Missing space ID for clickup.folders selector')
      }
      const data = await requestJson(selectorContracts.clickupFoldersSelectorContract, {
        body: {
          credential: credentialId,
          spaceId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.folders || []).map((folder) => ({
        id: folder.id,
        label: folder.name,
      }))
    },
  },
  'clickup.lists': {
    key: 'clickup.lists',
    contracts: [selectorContracts.clickupListsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'clickup.lists',
      context.oauthCredential ?? 'none',
      context.spaceId ?? 'none',
      context.folderId ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && (context.folderId || context.spaceId)),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'clickup.lists')
      if (!context.folderId && !context.spaceId) {
        throw new Error('Missing folder or space ID for clickup.lists selector')
      }
      const data = await requestJson(selectorContracts.clickupListsSelectorContract, {
        body: {
          credential: credentialId,
          folderId: context.folderId,
          spaceId: context.spaceId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.lists || []).map((list) => ({
        id: list.id,
        label: list.name,
      }))
    },
  },
} satisfies Record<
  Extract<
    SelectorKey,
    'clickup.workspaces' | 'clickup.spaces' | 'clickup.folders' | 'clickup.lists'
  >,
  SelectorDefinition
>
