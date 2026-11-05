'use client'

import { useCallback, useMemo, useState } from 'react'
import { writeTextToClipboard } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { SIM_DOCS_URL } from '@sim/utils/site'
import { useQueryStates } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import type { SimLink, SimLinkBody } from '@/lib/api/contracts/sim-links'
import { simLinkPath, simLinkUrl } from '@/lib/navigation/paths'
import {
  isVariableSimLinkUrl,
  simLinkFieldsSchema,
  toSimLinkName,
} from '@/lib/sim-links/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  boundedSearch,
  simLinksParsers,
  simLinksSortParams,
  simLinksUrlKeys,
} from '@/app/o/[organizationId]/links/search-params'
import {
  useCreateSimLink,
  useDeleteSimLink,
  useSimLinks,
  useUpdateSimLink,
} from '@/hooks/queries/sim-links'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { loadMoreOf, queryView } from '@/platform/lib/data/query-view'

const logger = createLogger('SimLinks')

const SIM_FOR_CHROME_URL =
  'https://chromewebstore.google.com/detail/sim/oanlcahddodnjpdoopcpjlcageejjpmg'
const SIM_LINKS_DOCS_URL = `${SIM_DOCS_URL}/search/sim-links`
const COPY_NOTICE_ID = 'sim-link-copy'

const SORT_OPTIONS = [
  { id: 'name', label: 'Name' },
  { id: 'popular', label: 'Opens' },
] as const

type LinkField = 'name' | 'url' | 'defaultUrl' | 'description'

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function openChromeStore() {
  openInNewTab(SIM_FOR_CHROME_URL)
}

export function openLinkDocs() {
  openInNewTab(SIM_LINKS_DOCS_URL)
}

export function openLink(name: string) {
  openInNewTab(simLinkPath(name))
}

/** Every Sim link the viewer may browse, driven by the page's URL state. */
export function useLinksPage(organizationId: string) {
  const [{ search, create }, setView] = useQueryStates(simLinksParsers, simLinksUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setView({ search: value && boundedSearch(value) }, options)
  )
  const settled = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const { sort, dir, activeSort, onSort, onClear } = useUrlSort(simLinksSortParams, simLinksUrlKeys)
  const term = settled.trim()
  const links = useSimLinks(organizationId, term, sort, dir)
  const remove = useDeleteSimLink(organizationId)
  const notices = usePlatformNotices()

  const rows = useMemo(() => links.data?.pages.flatMap((page) => page.links) ?? [], [links.data])
  const paging = loadMoreOf(links, 'Failed to load more links')
  // Asking for a page cancels a running refetch, so paging waits for it to settle.
  const hasMore = paging.hasMore && !links.isFetching
  const { loading, error: loadMoreError } = paging
  const { fetchNextPage } = links
  const loadMore = useMemo(
    () => ({
      hasMore,
      loading,
      error: loadMoreError,
      onLoadMore: () => void fetchNextPage(),
    }),
    [hasMore, loading, loadMoreError, fetchNextPage]
  )
  const copy = useCallback(
    async (name: string) => {
      try {
        await writeTextToClipboard(simLinkUrl(window.location.origin, name))
        notices.notify({ id: COPY_NOTICE_ID, title: 'Link copied', icon: 'I006' })
      } catch (error) {
        logger.error('Failed to copy Sim link', { error })
        notices.notify({ id: COPY_NOTICE_ID, title: 'Unable to copy link', icon: 'I006' })
      }
    },
    [notices]
  )

  const sortActions: MenuAction[] = [
    ...(activeSort
      ? [{ id: 'clear', label: 'Clear sort', icon: 'I105' as const, onSelect: onClear }]
      : []),
    ...SORT_OPTIONS.map(({ id, label }, index) => {
      const direction = activeSort?.column === id ? activeSort.direction : null
      return {
        id,
        label,
        separatorBefore: Boolean(activeSort) && index === 0,
        trailingIcon: direction ? (direction === 'asc' ? 'I023' : 'I102') : undefined,
        onSelect: () => onSort(id, direction === 'desc' ? 'asc' : 'desc'),
      } satisfies MenuAction
    }),
  ]
  const activeSortLabel = SORT_OPTIONS.find(({ id }) => id === activeSort?.column)?.label

  return {
    ...queryView(links),
    error: links.error?.message,
    rows,
    /** The rows still belong to the previous search, so an empty list says nothing yet. */
    isPlaceholder: links.isPlaceholderData,
    term,
    search,
    setSearch,
    sortLabel: activeSortLabel ? `Sort: ${activeSortLabel}` : 'Sort',
    sortActions,
    loadMore,
    /** The name to prefill when the URL asks for a new link; null when it does not. */
    createName: create === null ? null : toSimLinkName(create),
    startCreate: () => void setView({ create: '' }),
    closeCreate: () => void setView({ create: null }),
    copy,
    remove: async (id: string) => {
      await remove.mutateAsync(id)
    },
  }
}

function draftOf(link: SimLink | undefined, initialName = ''): SimLinkBody {
  return {
    name: link?.name ?? initialName,
    url: link?.url ?? '',
    defaultUrl: link?.defaultUrl ?? null,
    description: link?.description ?? '',
    unlisted: link?.unlisted ?? false,
    restrictEdit: link?.restrictEdit ?? false,
  }
}

/** One open editor's draft. Mount it per link (keyed) so each starts from that link's saved fields. */
export function useLinkEditor(organizationId: string, link?: SimLink, initialName?: string) {
  const create = useCreateSimLink(organizationId)
  const update = useUpdateSimLink(organizationId)
  const [draft, setDraft] = useState(() => draftOf(link, initialName))
  const [errors, setErrors] = useState<Partial<Record<LinkField, string>>>({})
  const variable = isVariableSimLinkUrl(draft.url)
  const change = <K extends keyof SimLinkBody>(field: K, value: SimLinkBody[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }
  return {
    draft,
    errors,
    variable,
    canManage: link?.canManage ?? true,
    pending: create.isPending || update.isPending,
    change,
    changeName: (value: string) => change('name', toSimLinkName(value)),
    /**
     * Resolves `false` when the problem is shown on a field, which keeps the dialog open without a
     * second message. Any other failure rejects, and the dialog shows it.
     */
    save: async () => {
      const parsed = simLinkFieldsSchema.safeParse({
        ...draft,
        defaultUrl: variable ? draft.defaultUrl : null,
      })
      if (!parsed.success) {
        setErrors(flattenFieldErrors<LinkField>(parsed.error))
        return false
      }
      try {
        if (link) await update.mutateAsync({ linkId: link.id, body: parsed.data })
        else await create.mutateAsync(parsed.data)
        return true
      } catch (error) {
        if (!isApiClientError(error) || error.status !== 409) throw error
        setErrors((current) => ({ ...current, name: error.message }))
        return false
      }
    },
  }
}
