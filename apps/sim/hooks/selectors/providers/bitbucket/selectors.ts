import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const bitbucketSelectors = {
  'bitbucket.workspaces': {
    key: 'bitbucket.workspaces',
    contracts: [selectorContracts.bitbucketWorkspacesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'bitbucket.workspaces',
      context.oauthCredential ?? 'none',
      context.workflowId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    /** Loads one Bitbucket page so the shared selector hook can progressively drain it. */
    fetchPage: async ({ context, cursor, signal }) => {
      const credentialId = ensureCredential(context, 'bitbucket.workspaces')
      const data = await requestJson(selectorContracts.bitbucketWorkspacesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          cursor,
        },
        signal,
      })

      return {
        items: data.workspaces.map((workspace) => ({
          id: workspace.slug,
          label: workspace.name,
          meta: {
            slug: workspace.slug,
            uuid: workspace.uuid,
            fullName: workspace.name,
            administrator: workspace.administrator,
          },
        })),
        nextCursor: data.nextCursor,
      }
    },
  },
  'bitbucket.repositories': {
    key: 'bitbucket.repositories',
    contracts: [selectorContracts.bitbucketRepositoriesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'bitbucket.repositories',
      context.oauthCredential ?? 'none',
      context.workflowId ?? 'none',
      context.workspaceSlug ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.workspaceSlug),
    /**
     * Repository discovery is scoped to the selected workspace on every page;
     * no unscoped request is sent while the dependency is absent.
     */
    fetchPage: async ({ context, cursor, signal }) => {
      const credentialId = ensureCredential(context, 'bitbucket.repositories')
      if (!context.workspaceSlug) {
        throw new Error('Missing workspace slug for bitbucket.repositories selector')
      }

      const data = await requestJson(selectorContracts.bitbucketRepositoriesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          workspaceSlug: context.workspaceSlug,
          cursor,
        },
        signal,
      })

      return {
        items: data.repositories.map((repository) => ({
          id: repository.slug,
          label: repository.name,
          meta: {
            slug: repository.slug,
            uuid: repository.uuid,
            fullName: repository.fullName,
            workspaceSlug: context.workspaceSlug,
          },
        })),
        nextCursor: data.nextCursor,
      }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'bitbucket.workspaces' | 'bitbucket.repositories'>,
  SelectorDefinition
>
