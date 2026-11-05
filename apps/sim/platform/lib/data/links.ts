'use client'

import { useMemo, useState } from 'react'
import { SIM_LINK_NAME_MAX_LENGTH } from '@sim/browser-extension-protocol'
import { useQueryStates } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import type { SimLink, SimLinkBody } from '@/lib/api/contracts/sim-links'
import { faviconSrc } from '@/lib/favicon/url'
import { simLinkPath, simLinkUrl } from '@/lib/navigation/paths'
import { simLinksParsers, simLinksSortParams, simLinksUrlKeys } from '@/lib/sim-links/search-params'
import { SIM_FOR_CHROME_URL, SIM_LINKS_DOCS_URL } from '@/lib/sim-links/urls'
import {
  isVariableSimLinkUrl,
  SIM_LINK_DESCRIPTION_MAX_LENGTH,
  SIM_LINK_VARIABLE,
  simLinkFieldsSchema,
  simLinkOrigin,
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
import { loadMoreOf, queryView } from '@/platform/lib/data/query-view'
import { toast } from '@/platform/lib/data/toast'

const SORT_OPTIONS = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'popular:desc', label: 'Most opened' },
  { value: 'popular:asc', label: 'Least opened' },
]

type LinkField = 'name' | 'url' | 'defaultUrl' | 'description'

export interface LinkRow {
  id: string
  name: string
  url: string
  description: string | null
  ownerName: string | null
  ownerImage: string | null
  access: string | null
  updatedAt: string
  faviconSrc: string | null
  canEdit: boolean
  source: SimLink
}

/** How the link is shared beyond the default: open to everyone and editable by any member. */
function accessLabel(link: SimLink): string | null {
  const limits = [link.unlisted && 'Unlisted', link.restrictEdit && 'Restricted'].filter(Boolean)
  return limits.length ? limits.join(', ') : null
}

function toLinkRow(link: SimLink): LinkRow {
  const origin = simLinkOrigin(link.url)
  return {
    id: link.id,
    name: link.name,
    url: link.url,
    description: link.description,
    ownerName: link.createdBy?.name ?? null,
    ownerImage: link.createdBy?.image ?? null,
    access: accessLabel(link),
    updatedAt: link.updatedAt,
    faviconSrc: origin ? faviconSrc(new URL(origin).hostname) : null,
    canEdit: link.canEdit,
    source: link,
  }
}

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Every Sim link the viewer may browse. `sim/<name>` resolves on the main app, not in this zone. */
export function useLinksSection(organizationId: string, legacyOrigin: string) {
  const [{ search, create }, setView] = useQueryStates(simLinksParsers, simLinksUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setView({ search: value }, options)
  )
  const settled = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const { sort, dir, onSort } = useUrlSort(simLinksSortParams, simLinksUrlKeys)
  const term = settled.trim()
  const links = useSimLinks(organizationId, term, sort, dir)
  const remove = useDeleteSimLink(organizationId)
  const rows = useMemo(
    () => links.data?.pages.flatMap((page) => page.links).map(toLinkRow) ?? [],
    [links.data]
  )
  return {
    ...queryView(links),
    error: links.error?.message,
    rows,
    term,
    search,
    setSearch,
    sortOptions: SORT_OPTIONS,
    sortValue: `${sort}:${dir}`,
    setSort: (value: string) => {
      const [column, direction] = value.split(':')
      if (direction === 'asc' || direction === 'desc') onSort(column, direction)
    },
    loadMore: loadMoreOf(links, 'Failed to load more links'),
    /** The name to prefill when the URL asks for a new link; null when it does not. */
    createName: create === null ? null : toSimLinkName(create),
    startCreate: () => void setView({ create: '' }),
    closeCreate: () => void setView({ create: null }),
    open: (name: string) => openInNewTab(`${legacyOrigin}${simLinkPath(name)}`),
    copy: async (name: string) => {
      try {
        await navigator.clipboard.writeText(simLinkUrl(legacyOrigin, name))
        toast.success('Link copied')
      } catch {
        toast.error('Unable to copy link')
      }
    },
    remove: async (id: string) => {
      await remove.mutateAsync(id)
    },
    openChromeStore: () => openInNewTab(SIM_FOR_CHROME_URL),
    openDocs: () => openInNewTab(SIM_LINKS_DOCS_URL),
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
    variableToken: SIM_LINK_VARIABLE,
    nameMaxLength: SIM_LINK_NAME_MAX_LENGTH,
    descriptionMaxLength: SIM_LINK_DESCRIPTION_MAX_LENGTH,
    canManage: link?.canManage ?? true,
    change,
    changeName: (value: string) => change('name', toSimLinkName(value)),
    /** A rejection keeps the dialog open: a field's problem also shows on that field. */
    save: async () => {
      const parsed = simLinkFieldsSchema.safeParse({
        ...draft,
        defaultUrl: variable ? draft.defaultUrl : null,
      })
      if (!parsed.success) {
        const next: Partial<Record<LinkField, string>> = {}
        for (const issue of parsed.error.issues) next[issue.path[0] as LinkField] = issue.message
        setErrors(next)
        throw new Error('Check the highlighted fields')
      }
      try {
        if (link) await update.mutateAsync({ linkId: link.id, body: parsed.data })
        else await create.mutateAsync(parsed.data)
      } catch (error) {
        if (isApiClientError(error) && error.status === 409) {
          setErrors((current) => ({ ...current, name: error.message }))
        }
        throw error
      }
    },
  }
}
