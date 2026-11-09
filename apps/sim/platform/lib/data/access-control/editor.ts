'use client'

import { useMemo } from 'react'
import { useQueryState } from 'nuqs'
import type { PermissionGroupEditorCatalog } from '@/lib/api/contracts/permission-groups'
import type { ModelFacts } from '@/lib/permission-groups/model-gate'
import { usePermissionGroupEditorCatalog } from '@/ee/access-control/hooks/permission-groups'
import { createEditorCatalog } from '@/ee/access-control/lib/editor'
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
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSettingsSearch } from '@/hooks/use-settings-search'
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

/**
 * `blacklist` is null while the deployment's provider blacklist is unread or failed: no provider is
 * offered then, as legacy did, while blocks and the rest of the catalog stay editable.
 */
function toEditorModel(catalog: PermissionGroupEditorCatalog, blacklist: readonly string[] | null) {
  const definitions = new Map(catalog.providers.map((provider) => [provider.id, provider]))
  const providerIds = blacklist
    ? catalog.providerIds.filter((id) => !blacklist.includes(id.toLowerCase()))
    : []
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

/** The block and provider catalog the editor resolves access against, or the read's failure. */
export function usePermissionEditorModel(organizationId: string) {
  const catalog = usePermissionGroupEditorCatalog(organizationId)
  const blacklist = useBlacklistedProviders()
  const model = useMemo(
    () =>
      catalog.data
        ? toEditorModel(catalog.data, blacklist.data?.blacklistedProviders ?? null)
        : null,
    [catalog.data, blacklist.data]
  )
  return {
    model,
    isLoading: catalog.isPending,
    error: catalog.error,
    retrying: catalog.isFetching,
    retry: () => void catalog.refetch(),
    /** The provider blacklist's own read, which gates only the Model Providers tab. */
    providers: {
      isLoading: blacklist.isPending,
      error: blacklist.error,
      retrying: blacklist.isFetching,
      retry: () => void blacklist.refetch(),
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
