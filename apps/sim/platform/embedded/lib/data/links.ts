'use client'

import { useCallback, useMemo, useState } from 'react'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { writeTextToClipboard } from '@sim/emcn-legacy'
import { createLogger } from '@sim/logger'
import { SIM_DOCS_URL } from '@sim/utils/site'
import { useQueryStates } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import type { SimLink, SimLinkBody } from '@/lib/api/contracts/sim-links'
import { simLinkPath, simLinkUrl } from '@/lib/navigation/paths'
import {
  boundedSearch,
  simLinksParsers,
  simLinksSortParams,
  simLinksUrlKeys,
} from '@/lib/sim-links/search-params'
import {
  isVariableSimLinkUrl,
  simLinkFieldsSchema,
  toSimLinkName,
} from '@/lib/sim-links/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  useCreateSimLink,
  useDeleteSimLink,
  useSimLinks,
  useUpdateSimLink,
} from '@/hooks/queries/sim-links'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'
import { usePlatformNotices } from '@/platform/embedded/lib/notices'
import { openLinkInNewTab } from '@/platform/embedded/lib/row-links'

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

export function openChromeStore() {
  openLinkInNewTab(SIM_FOR_CHROME_URL)
}

export function openLinkDocs() {
  openLinkInNewTab(SIM_LINKS_DOCS_URL)
}

export function openLink(name: string) {
  openLinkInNewTab(simLinkPath(name))
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
  // Placeholder rows belong to the previous search, and asking for a page cancels a running refetch.
  const hasMore = links.hasNextPage && !links.isPlaceholderData && !links.isFetching
  const { isFetchingNextPage, isFetchNextPageError, fetchNextPage } = links
  const loadMore = useMemo(
    () => ({
      hasMore,
      loading: isFetchingNextPage,
      error: isFetchNextPageError ? 'Failed to load more links' : undefined,
      onLoadMore: () => void fetchNextPage(),
    }),
    [hasMore, isFetchingNextPage, isFetchNextPageError, fetchNextPage]
  )
  const copy = useCallback(
    async (name: string) => {
      try {
        await writeTextToClipboard(simLinkUrl(window.location.origin, name))
        notices.notify({ id: COPY_NOTICE_ID, title: 'Link copied', variant: 'success' })
      } catch (error) {
        logger.error('Failed to copy Sim link', { error })
        notices.notify({ id: COPY_NOTICE_ID, title: 'Unable to copy link', variant: 'error' })
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
    /** A failed refresh keeps its rows; only a list that never loaded reports a failure. */
    status: links.isLoadingError
      ? ('error' as const)
      : links.data
        ? ('success' as const)
        : ('pending' as const),
    retry: () => void links.refetch(),
    error: links.error?.message,
    rows,
    /** The rows still belong to the previous search, so an empty list says nothing yet. */
    isPlaceholder: links.isPlaceholderData,
    /** When the rows were read, which server and client agree on. Unset for placeholder rows. */
    asOf: links.isPlaceholderData ? undefined : links.dataUpdatedAt,
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

function draftOf(link: SimLink | undefined, initialName = '', initialUrl = ''): SimLinkBody {
  return {
    name: link?.name ?? initialName,
    url: link?.url ?? initialUrl,
    defaultUrl: link?.defaultUrl ?? null,
    description: link?.description ?? '',
    unlisted: link?.unlisted ?? false,
    restrictEdit: link?.restrictEdit ?? false,
  }
}

/** One open editor's draft. Mount it per link (keyed) so each starts from that link's saved fields. */
export function useLinkEditor(
  organizationId: string,
  link?: SimLink,
  initialName?: string,
  initialUrl?: string
) {
  const create = useCreateSimLink(organizationId)
  const update = useUpdateSimLink(organizationId)
  const [draft, setDraft] = useState(() => draftOf(link, initialName, initialUrl))
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
