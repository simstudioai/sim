'use client'

import { useMemo } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { ModelFacts } from '@/lib/permission-groups/model-gate'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { createEditorCatalog } from '@/ee/access-control/lib/editor'
import type { PermissionGroupEditorCatalog } from '@/ee/access-control/lib/editor-catalog-model'
import {
  groupIdParam,
  groupIdUrlKeys,
  groupSearchParam,
  groupSearchUrlKeys,
  groupStatusParam,
  groupStatusUrlKeys,
  groupTabParam,
  groupTabUrlKeys,
} from '@/ee/access-control/search-params'
import { useBlacklistedProviders } from '@/hooks/queries/allowed-providers'
import { permissionGroupKeys } from '@/hooks/queries/utils/permission-group-keys'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import {
  findProviderForModel,
  isAutoModel,
  isCustomModelIn,
  isKnownModelIn,
} from '@/providers/model-lookup'

export type EditorBlock = PermissionGroupEditorCatalog['blocks'][number]

/** What the provider registry states, rebuilt from the server's projection of it. */
function catalogModelFacts(catalog: PermissionGroupEditorCatalog): ModelFacts {
  const matchers = catalog.providers.map(
    (provider) =>
      [
        provider.id,
        {
          models: provider.models,
          modelPatterns: provider.modelPatterns.map(
            ({ source, flags }) => new RegExp(source, flags)
          ),
        },
      ] as const
  )
  const namespaced = new Set(catalog.providers.filter((p) => p.namespaced).map((p) => p.id))
  const dynamic = new Set(catalog.dynamicProviderIds)
  const staticProviders = catalog.providers.filter((provider) => !dynamic.has(provider.id))
  const staticIds = new Set(
    staticProviders.flatMap((provider) => provider.models.map((model) => model.id.toLowerCase()))
  )
  const sunset = new Map(
    staticProviders.flatMap((provider) =>
      provider.models.flatMap((model) =>
        model.sunset ? [[model.id.toLowerCase(), model.sunset] as const] : []
      )
    )
  )
  const providerByModel = new Map<string, string | null>()
  const findProvider = (model: string) => {
    let provider = providerByModel.get(model)
    if (provider === undefined) {
      provider = findProviderForModel(matchers, namespaced, model)
      providerByModel.set(model, provider)
    }
    return provider
  }
  return {
    findProvider,
    isKnown: (model) => isKnownModelIn(staticIds, catalog.dynamicProviderIds, model),
    isCustom: (model) => isCustomModelIn(findProvider, namespaced, model),
    isAuto: isAutoModel,
    sunsetStatus: (model) => sunset.get(model.toLowerCase()),
  }
}

function toEditorModel(catalog: PermissionGroupEditorCatalog, blacklist: readonly string[]) {
  const definitions = new Map(catalog.providers.map((provider) => [provider.id, provider]))
  const providerIds = catalog.providerIds.filter((id) => !blacklist.includes(id.toLowerCase()))
  return {
    /** The whole allowlist universe. Only `visibleBlocks` is drawn. */
    blocks: catalog.blocks,
    visibleBlocks: catalog.blocks.filter((block) => !block.hidden),
    providerIds,
    knowledgeConnectors: catalog.knowledgeConnectors,
    dynamicProviderIds: catalog.dynamicProviderIds,
    providerName: (id: string) => definitions.get(id)?.name ?? id,
    providerModels: (id: string) => definitions.get(id)?.models.map((model) => model.id) ?? [],
    facts: catalogModelFacts(catalog),
    accessCatalog: createEditorCatalog({
      blocks: catalog.blocks.map((block) => ({
        type: block.type,
        name: block.name,
        toolIds: block.tools.map((tool) => tool.id),
      })),
      providers: providerIds.map((id) => ({
        id,
        label: definitions.get(id)?.name ?? id,
        modelIds:
          definitions
            .get(id)
            ?.models.filter((model) => model.inStaticCatalog && model.sunset !== 'deprecated')
            .map((model) => model.id) ?? [],
      })),
      knowledgeConnectors: catalog.knowledgeConnectors,
    }),
  }
}

export type EditorModel = ReturnType<typeof toEditorModel>

/**
 * The route's server read seeds this; a failed read leaves it empty and a refresh repeats it. Nothing
 * can refetch it, so the section holds an observer to keep it through time spent on the group list.
 */
export function usePermissionEditorCatalog(organizationId: string) {
  return useQuery<PermissionGroupEditorCatalog>({
    queryKey: permissionGroupKeys.editorCatalog(organizationId),
    queryFn: skipToken,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** The block and provider catalog the editor resolves access against, or the read's failure. */
export function usePermissionEditorModel(organizationId: string) {
  const router = useRouter()
  const catalog = usePermissionEditorCatalog(organizationId)
  const blacklist = useBlacklistedProviders()
  const model = useMemo(
    () =>
      catalog.data && blacklist.data
        ? toEditorModel(catalog.data, blacklist.data.blacklistedProviders)
        : null,
    [catalog.data, blacklist.data]
  )
  return {
    model,
    isLoading: blacklist.isPending,
    error: blacklist.error ?? (catalog.data ? null : new Error('Could not load the block catalog')),
    retrying: blacklist.isFetching,
    retry: () => {
      router.refresh()
      void blacklist.refetch()
    },
  }
}

/** The list's search and the group being viewed. */
export function useAccessControlParams() {
  const [search, setSearch] = useSettingsSearch()
  const [groupId, setGroupId] = useQueryState(groupIdParam.key, {
    ...groupIdParam.parser,
    ...groupIdUrlKeys,
  })
  const [, setTab] = useQueryState(groupTabParam.key, {
    ...groupTabParam.parser,
    ...groupTabUrlKeys,
  })
  const [, setGroupSearch] = useQueryState(groupSearchParam.key, {
    ...groupSearchParam.parser,
    ...groupSearchUrlKeys,
  })
  const [, setStatus] = useQueryState(groupStatusParam.key, {
    ...groupStatusParam.parser,
    ...groupStatusUrlKeys,
  })
  /**
   * The detail view's params are scoped to one group, so both transitions reset them: a stale
   * `group-id` would otherwise open the next group on the previous group's tab and filters.
   */
  const resetDetail = () => {
    void setTab(null)
    void setGroupSearch(null)
    void setStatus(null)
  }
  return {
    search,
    setSearch,
    groupId,
    openGroup: (id: string) => {
      void setGroupId(id)
      resetDetail()
    },
    closeGroup: () => {
      void setGroupId(null, { history: 'replace' })
      resetDetail()
    },
  }
}

/** The detail view's tab, search and status filter. Switching tabs carries neither filter over. */
export function useGroupDetailParams() {
  const [tab, setTab] = useQueryState(groupTabParam.key, {
    ...groupTabParam.parser,
    ...groupTabUrlKeys,
  })
  const [search, setSearchParam] = useQueryState(groupSearchParam.key, {
    ...groupSearchParam.parser,
    ...groupSearchUrlKeys,
  })
  const setSearch = useDebouncedSearchSetter(setSearchParam)
  const [status, setStatus] = useQueryState(groupStatusParam.key, {
    ...groupStatusParam.parser,
    ...groupStatusUrlKeys,
  })
  return {
    tab,
    search,
    setSearch,
    status,
    setStatus: (next: typeof status) => void setStatus(next),
    selectTab: (next: typeof tab) => {
      void setTab(next)
      setSearch('')
      void setStatus(null)
    },
  }
}
