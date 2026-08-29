import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { selectRawMountableSecretNames } from '@/lib/credentials/secret-mount-options'
import { fetchWorkspaceEnvironment } from '@/lib/environment/api'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { environmentKeys, WORKSPACE_ENVIRONMENT_STALE_TIME } from '@/hooks/queries/environment'
import { getSandboxListQueryOptions } from '@/hooks/queries/sandboxes'
import {
  CREDENTIAL_GROUP_LIST_STALE_TIME,
  credentialGroupKeys,
  fetchCredentialGroupSettings,
} from '@/hooks/queries/utils/credential-group-queries'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import {
  fetchWorkspaceCredentialList,
  WORKSPACE_CREDENTIAL_LIST_STALE_TIME,
} from '@/hooks/queries/utils/fetch-workspace-credentials'
import { SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorContext,
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

/**
 * Workspace-scoped option lists: things a block picks from its OWN workspace rather than from
 * a third-party account. They are selectors for the same reason the credential-scoped ones
 * are — a per-block fetcher reading the active-workspace store only works on the canvas — but
 * their context key is `workspaceId` instead of `oauthCredential`.
 */

function workspaceCredentials(workspaceId: string) {
  return getQueryClient().fetchQuery({
    queryKey: workspaceCredentialKeys.list(workspaceId),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchWorkspaceCredentialList(workspaceId, signal),
    staleTime: WORKSPACE_CREDENTIAL_LIST_STALE_TIME,
  })
}

async function credentialGroups(workspaceId: string) {
  const settings = await getQueryClient().fetchQuery({
    queryKey: credentialGroupKeys.list(workspaceId),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchCredentialGroupSettings(workspaceId, signal),
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
  })
  return settings.credentialGroups
}

function workspaceScoped(
  key: SelectorKey,
  fetchList: (workspaceId: string, context: SelectorContext) => Promise<SelectorOption[]>,
  extraKey?: (context: SelectorContext) => string
): SelectorDefinition {
  return {
    key,
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      key,
      context.workspaceId ?? 'none',
      ...(extraKey ? [extraKey(context)] : []),
    ],
    enabled: ({ context }) => Boolean(context.workspaceId),
    fetchList: ({ context }: SelectorQueryArgs) =>
      context.workspaceId ? fetchList(context.workspaceId, context) : Promise.resolve([]),
  }
}

export const workspaceSelectors = {
  /** Distinct OAuth providers the workspace holds a credential for. */
  'workspace.credentialProviders': {
    ...workspaceScoped('workspace.credentialProviders', async (workspaceId) => {
      const credentials = await workspaceCredentials(workspaceId)
      const seen = new Set<string>()
      const options: SelectorOption[] = []
      for (const credential of credentials) {
        if (credential.type !== 'oauth' || !credential.providerId) continue
        if (seen.has(credential.providerId)) continue
        seen.add(credential.providerId)
        const service = getServiceConfigByProviderId(credential.providerId)
        options.push({ id: credential.providerId, label: service?.name ?? credential.providerId })
      }
      return options.sort((a, b) => a.label.localeCompare(b.label))
    }),
    // Resolves a stored provider id with no list fetch at all — the service registry is local.
    fetchById: async ({ detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const service = getServiceConfigByProviderId(detailId)
      return { id: detailId, label: service?.name ?? detailId }
    },
  },
  'workspace.credentialGroups': {
    ...workspaceScoped('workspace.credentialGroups', async (workspaceId) => {
      const groups = await credentialGroups(workspaceId)
      return groups
        .filter((group) => group.status === 'active')
        .map((group) => ({ id: group.id, label: group.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }),
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!context.workspaceId || !detailId) return null
      const group = (await credentialGroups(context.workspaceId)).find(
        (candidate) => candidate.id === detailId
      )
      return group ? { id: group.id, label: group.name } : null
    },
  },
  /** Providers represented inside ONE credential group, for its per-provider filter. */
  'workspace.credentialGroupProviders': {
    ...workspaceScoped(
      'workspace.credentialGroupProviders',
      async (workspaceId, context) => {
        if (!context.credentialGroupId) return []
        const group = (await credentialGroups(workspaceId)).find(
          (candidate) => candidate.id === context.credentialGroupId
        )
        if (!group) return []
        return group.options
          .filter((option) => option.status === 'active')
          .map((option) => {
            const service = getCredentialGroupProviderService(option.provider)
            return { id: service.providerId, label: service.name }
          })
          .sort((a, b) => a.label.localeCompare(b.label))
      },
      (context) => context.credentialGroupId ?? 'none'
    ),
    /**
     * Resolves one stored provider id to its service name. The field is multi-select, so the
     * canvas card summarises several stored ids at once and needs each label before (or
     * without) the full list — which is what `useDynamicSubBlockOptionDisplayName` asks for.
     */
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!context.workspaceId || !context.credentialGroupId || !detailId) return null
      const group = (await credentialGroups(context.workspaceId)).find(
        (candidate) => candidate.id === context.credentialGroupId
      )
      const option = group?.options.find(
        (candidate) =>
          candidate.status === 'active' &&
          getCredentialGroupProviderService(candidate.provider).providerId === detailId
      )
      if (!option) return null
      const service = getCredentialGroupProviderService(option.provider)
      return { id: service.providerId, label: service.name }
    },
  },
  /**
   * Secret NAMES the workspace can resolve. Names only — values stay server-side and are
   * injected at execution. Both halves come from the one workspace-environment response, the
   * client mirror of `getEffectiveDecryptedEnv`, so this picker and the `{{VAR}}` autocomplete
   * can never disagree about what exists.
   */
  'workspace.secretNames': workspaceScoped('workspace.secretNames', async (workspaceId) => {
    const environment = await getQueryClient().fetchQuery({
      queryKey: environmentKeys.workspace(workspaceId),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        fetchWorkspaceEnvironment(workspaceId, signal),
      staleTime: WORKSPACE_ENVIRONMENT_STALE_TIME,
    })
    const names = new Set<string>([
      ...Object.keys(environment?.workspace ?? {}),
      ...Object.keys(environment?.personal ?? {}),
    ])
    return [...names].sort().map((name) => ({ id: name, label: name }))
  }),
  /** Only the secret names the current actor may mount as PLAINTEXT into Copilot code. */
  'workspace.rawSecretNames': workspaceScoped('workspace.rawSecretNames', async (workspaceId) => {
    const credentials = await workspaceCredentials(workspaceId)
    return selectRawMountableSecretNames(credentials).map((name) => ({ id: name, label: name }))
  }),
  /**
   * Sandboxes a Function block can run in, narrowed to the language its sibling selects — a
   * Python block must never be offered an npm sandbox. `shell` runs anywhere.
   */
  'workspace.sandboxes': {
    ...workspaceScoped(
      'workspace.sandboxes',
      async (workspaceId, context) => {
        const { sandboxes } = await getQueryClient().fetchQuery(
          getSandboxListQueryOptions(workspaceId)
        )
        const language = context.language
        return sandboxes
          .filter((sandbox) => !language || language === 'shell' || sandbox.language === language)
          .map((sandbox) => ({ id: sandbox.id, label: sandbox.name }))
      },
      (context) => context.language ?? 'any'
    ),
    /**
     * A selection left over from before a language switch is still shown, flagged rather than
     * hidden: returning `null` would drop the field to its placeholder while the value stayed
     * stored and stayed fatal at execution — cleared-looking, still broken, nothing to point at.
     */
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!context.workspaceId || !detailId) return null
      const { sandboxes } = await getQueryClient().fetchQuery(
        getSandboxListQueryOptions(context.workspaceId)
      )
      const sandbox = sandboxes.find((candidate) => candidate.id === detailId)
      if (!sandbox) return null
      const option = { id: sandbox.id, label: sandbox.name }
      const language = context.language
      if ((language === 'python' || language === 'javascript') && sandbox.language !== language) {
        return { ...option, label: `${option.label} · wrong language for this block` }
      }
      return option
    },
  },
  /**
   * The trigger vocabulary the Logs page filter offers, so the Logs block and that page name a
   * run's origin identically. Workspace-independent, but registered here because it is the
   * Logs block's list.
   *
   * The registry is reached lazily: `getTriggerOptions` reads the block and trigger registries,
   * and importing it eagerly from a module block definitions import would close a cycle.
   * Entries sharing a label merge into one comma-joined id, because the filter is a
   * comma-separated list end to end and two identical rows would be unselectable apart.
   */
  'workspace.triggerTypes': {
    key: 'workspace.triggerTypes',
    staleTime: SELECTOR_STALE,
    getQueryKey: () => ['selectors', 'workspace.triggerTypes'],
    fetchList: async () => {
      const { getTriggerOptions } = await import('@/lib/logs/get-trigger-options')
      const valuesByLabel = new Map<string, string[]>()
      for (const option of getTriggerOptions()) {
        const values = valuesByLabel.get(option.label)
        if (values) values.push(option.value)
        else valuesByLabel.set(option.label, [option.value])
      }
      return Array.from(valuesByLabel, ([label, values]) => ({ id: values.join(','), label }))
    },
  },
} satisfies Partial<Record<SelectorKey, SelectorDefinition>>

/**
 * The OpenRouter embedding catalog. Workspace-independent — the list is the same for everyone
 * — but a selector rather than a static array because it is fetched, and a fetched list has to
 * be reachable from every surface, not just the canvas.
 */
export const providerSelectors = {
  'providers.openrouterEmbeddingModels': {
    key: 'providers.openrouterEmbeddingModels',
    staleTime: SELECTOR_STALE,
    getQueryKey: () => ['selectors', 'providers.openrouterEmbeddingModels'],
    fetchList: async () => {
      const { providerModelsQueryOptions } = await import('@/hooks/queries/providers')
      const { models } = await getQueryClient().fetchQuery(
        providerModelsQueryOptions('openrouter-embeddings')
      )
      return models.map((model: string) => ({ id: model, label: model }))
    },
  },
} satisfies Partial<Record<SelectorKey, SelectorDefinition>>
