'use client'

import { useMemo, useState } from 'react'
import { useQueryStates } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import type {
  ChartBranch as ContractChartBranch,
  PeopleImportResult as ContractImportResult,
  Person as ContractPerson,
  PersonSummary as ContractPersonSummary,
  PeopleImportBody,
  PersonBody,
} from '@/lib/api/contracts/people'
import {
  type PeopleSyncConfig,
  type PeopleSyncStatus,
  peopleSyncConfigSchema,
} from '@/lib/api/contracts/people-sync'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import { readPeopleSheet } from '@/lib/people/read-sheet'
import { peopleParsers, peopleUrlKeys, serializePeopleView } from '@/lib/people/search-params'
import { memberProfileFieldsSchema, PEOPLE_SEARCH_MAX_LENGTH } from '@/lib/people/validation'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useScimConnection } from '@/ee/scim/hooks/scim'
import {
  useDepartments,
  useImportPeople,
  usePeople,
  usePeopleChart,
  usePerson,
  useUpdatePerson,
} from '@/hooks/queries/people'
import {
  isDirectorySyncAccessError,
  usePeopleSyncActions,
  usePeopleSyncStatus,
} from '@/hooks/queries/people-sync'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'

export type ChartBranch = ContractChartBranch
export type PeopleImportResult = ContractImportResult
export type Person = ContractPerson
export type PersonSummary = ContractPersonSummary
export type SyncStatus = PeopleSyncStatus

const PEOPLE_PATH = '/people'

export function personHref(memberId: string, originQuery: string): string {
  return `${PEOPLE_PATH}/${encodeURIComponent(memberId)}${originQuery}`
}

/** A contract's 404: the person left, as opposed to the viewer being refused. */
export function isGone(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404
}

/** A stale preview's 409: the directory moved, so it needs previewing again. */
export function isApiConflict(error: unknown): boolean {
  return isApiClientError(error) && error.status === 409
}

/** A refusal replaces what is on screen; a transient failure keeps it. */
function isRefusal(error: unknown): boolean {
  return isApiClientError(error) && error.status < 500
}

export function usePeopleUrl() {
  return useQueryStates(peopleParsers, peopleUrlKeys)
}

type PeopleUrl = ReturnType<typeof usePeopleUrl>[0]
type PeopleUrlOverrides = { [Key in keyof PeopleUrl]?: PeopleUrl[Key] | null }

/** The query a profile link carries, so Back returns to the same view. */
export function profileOriginQuery(origin: PeopleUrl, overrides: PeopleUrlOverrides): string {
  return serializePeopleView({ ...origin, panel: null, ...overrides })
}

function peopleViewHref(origin: PeopleUrl, overrides: PeopleUrlOverrides): string {
  return serializePeopleView(PEOPLE_PATH, { ...origin, panel: null, ...overrides })
}

/** The list and the department filter's own search, with the legacy page's debounce and bounds. */
export function usePeopleDirectory(organizationId: string) {
  const [origin, setView] = usePeopleUrl()
  const { search, department, departmentKey } = origin
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setView({ view: 'directory', search: value }, options)
  )
  const debounced = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS)
  const query = debounced.trim()
  const people = usePeople(organizationId, query, department, { departmentKey })
  const changingFilter = people.isPlaceholderData || query !== search.trim()
  const pages = people.isRefetchError || changingFilter ? undefined : people.data?.pages
  const rows = useMemo(() => (pages ?? []).flatMap((page) => page.people), [pages])
  const hasDepartment = Boolean(departmentKey || department)
  const departmentLabel = departmentKey
    ? (!people.isPlaceholderData && people.data?.pages[0]?.selectedDepartment) ||
      'Selected department'
    : department
  return {
    origin,
    search,
    query,
    setSearch,
    rows,
    hasDepartment,
    departmentLabel,
    loading: people.isPending || changingFilter,
    error: people.isLoadingError || people.isRefetchError ? people.error : null,
    retry: () => void people.refetch(),
    loadMore: {
      hasMore: people.hasNextPage && !changingFilter,
      loading: people.isFetchingNextPage,
      error: people.isFetchNextPageError ? people.error.message : undefined,
      onLoadMore: () => void people.fetchNextPage(),
    },
    setDepartment: (next: { name: string; key?: string } | null) =>
      void setView({
        view: 'directory',
        department: next && !next.key ? next.name : null,
        departmentKey: next?.key ?? null,
      }),
    clearFilters: () =>
      void setView({ view: 'directory', search: '', department: '', departmentKey: '' }),
  }
}

/** The filter's option values: stored text can't hold a NUL, so no department collides with these. */
const DEPARTMENT_KEY_PREFIX = '\u0000key:'
const ALL_DEPARTMENTS = '\u0000all'

export function useDepartmentOptions(
  organizationId: string,
  selected: { department: string; departmentKey: string }
) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const debounced = useSearchFilterValue(term, SEARCH_DEBOUNCE_MS).trim()
  const departments = useDepartments(organizationId, debounced, open)
  const waiting = term.trim() !== debounced
  const entries = useMemo(
    () => (waiting ? [] : (departments.data?.pages.flatMap((page) => page.departments) ?? [])),
    [waiting, departments.data]
  )
  const options = useMemo(
    () => [
      { value: ALL_DEPARTMENTS, label: 'All' },
      ...entries.map(({ name, count, departmentKey }) => ({
        value: departmentKey ? `${DEPARTMENT_KEY_PREFIX}${departmentKey}` : name,
        label: `${name} (${count})`,
      })),
    ],
    [entries]
  )
  return {
    options,
    onOpenChange: setOpen,
    value: selected.departmentKey
      ? `${DEPARTMENT_KEY_PREFIX}${selected.departmentKey}`
      : selected.department || ALL_DEPARTMENTS,
    /** Maps an option back to the URL's split between a plain name and an opaque key. */
    parse: (value: string | null): { name: string; key?: string } | null => {
      if (!value || value === ALL_DEPARTMENTS) return null
      return value.startsWith(DEPARTMENT_KEY_PREFIX)
        ? { name: '', key: value.slice(DEPARTMENT_KEY_PREFIX.length) }
        : { name: value }
    },
    search: {
      query: term,
      onQueryChange: (query: string) => setTerm(query.slice(0, PEOPLE_SEARCH_MAX_LENGTH)),
      hasMore: !waiting && departments.hasNextPage,
      loading: waiting || departments.isFetching,
      error: departments.error?.message,
      onLoadMore: () => void departments.fetchNextPage(),
      onRetry: () => void departments.refetch(),
    },
  }
}

/** Paginated directory search for the chart's pickers and for choosing a manager. */
export function usePeoplePicker(
  organizationId: string,
  scope?: 'roots' | 'members',
  excludeMemberId?: string
) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const debounced = useDebounce(term.trim(), SEARCH_DEBOUNCE_MS)
  const query = usePeople(organizationId, debounced, '', { scope, enabled: open })
  const waiting = term.trim() !== debounced || query.isPlaceholderData
  const pages = waiting || query.isRefetchError ? undefined : query.data?.pages
  const people = useMemo(
    () =>
      (pages ?? []).flatMap((page) =>
        page.people.filter((person) => person.memberId !== excludeMemberId)
      ),
    [pages, excludeMemberId]
  )
  const options = useMemo(
    () =>
      people.map((person) => ({
        value: person.memberId,
        label: [person.name, person.title, person.email].filter(Boolean).join(' · '),
      })),
    [people]
  )
  return {
    people,
    options,
    onOpenChange: setOpen,
    search: {
      query: term,
      onQueryChange: (next: string) => setTerm(next.slice(0, PEOPLE_SEARCH_MAX_LENGTH)),
      hasMore: query.hasNextPage && !waiting,
      loading: waiting || query.isFetching,
      error: query.error?.message,
      onLoadMore: () => void query.fetchNextPage(),
      onRetry: () => void query.refetch(),
    },
  }
}

const CHART_MAX_PAGE = 1_000_000

export function useOrgChart(organizationId: string) {
  const [origin, setView] = usePeopleUrl()
  const { focus, page } = origin
  const size = useIsMobile() ? 1 : 4
  const chart = usePeopleChart(
    organizationId,
    focus,
    Math.max(1, Math.min(page, CHART_MAX_PAGE)),
    size
  )
  const branch = isRefusal(chart.error) ? undefined : chart.data
  return {
    origin,
    setView,
    focus,
    page,
    size,
    branch,
    error: chart.error,
    retry: () => void chart.refetch(),
    profileQuery: profileOriginQuery(origin, {
      view: 'chart',
      focus: branch?.person.memberId ?? focus,
      page: branch?.page ?? page,
    }),
  }
}

/** The first top-level team, for the chart's empty state to offer. */
export function useChartRoots(organizationId: string) {
  const roots = usePeople(organizationId, '', '', { scope: 'roots' })
  const firstTeam = roots.isSuccess ? roots.data.pages[0]?.people[0] : undefined
  return { firstTeam, emptyOrganization: roots.isSuccess && !firstTeam }
}

export function usePersonProfile(organizationId: string, memberId: string) {
  const [origin] = usePeopleUrl()
  const query = usePerson(organizationId, memberId)
  // A transient refresh failure keeps the loaded profile and any open edit; a refusal does not.
  const loadError = query.data && !isRefusal(query.error) ? null : query.error
  const data = loadError ? undefined : query.data
  return {
    origin,
    data,
    error: loadError,
    retrying: query.isFetching,
    retry: () => void query.refetch(),
    originQuery: profileOriginQuery(origin, { view: origin.view ?? 'directory' }),
    chartHref: peopleViewHref(origin, {
      view: 'chart',
      focus: data?.person.memberId ?? memberId,
      page: origin.focus === data?.person.memberId ? origin.page : 1,
    }),
    departmentHref: (person: Person) =>
      peopleViewHref(origin, {
        view: 'directory',
        search: '',
        department: person.departmentKey ? null : person.department,
        departmentKey: person.departmentKey ?? null,
      }),
    backHref: peopleViewHref(origin, { view: origin.view ?? 'directory' }),
  }
}

export type PersonDraft = PersonBody

export function useEditPerson(organizationId: string, memberId: string) {
  const update = useUpdatePerson(organizationId)
  return {
    /** Field problems, or null once the update went through. A failed request rejects. */
    save: async (
      draft: PersonDraft
    ): Promise<Partial<Record<keyof PersonDraft, string>> | null> => {
      const parsed = memberProfileFieldsSchema.safeParse(draft)
      if (!parsed.success) {
        const errors: Partial<Record<keyof PersonDraft, string>> = {}
        for (const issue of parsed.error.issues) {
          errors[String(issue.path[0]) as keyof PersonDraft] = issue.message
        }
        return errors
      }
      await update.mutateAsync({ memberId, body: parsed.data })
      return null
    },
  }
}

export type ImportBody = PeopleImportBody

/** The import mutation that keeps provider tokens out of the mutation cache, and its sheet reader. */
export function usePeopleImport(organizationId: string) {
  const importPeople = useImportPeople(organizationId)
  return {
    submit: importPeople.submit,
    pending: importPeople.isPending,
    readSheet: readPeopleSheet,
  }
}

export function useProvisioningConnection(organizationId: string, enabled: boolean) {
  const connection = useScimConnection(organizationId, enabled)
  const directory = connection.data?.connection
  return {
    loading: connection.isLoading,
    failed: connection.isError,
    fetching: connection.isFetching,
    active: directory?.status === 'active',
    ready: connection.isSuccess && directory?.status === 'active',
    userCount: directory?.userCount ?? 0,
    refresh: () => void connection.refetch(),
  }
}

export type SyncSource = PeopleSyncConfig['source']

export interface SyncDraft {
  source: SyncSource
  domain: string
  token: string
  tenantId: string
  clientId: string
  clientSecret: string
}

export type SyncFieldErrors = Partial<Record<Exclude<keyof SyncDraft, 'source'>, string>>

/** The sync status with polling and the action state machine the hook keeps out of the cache. */
export function useDirectorySync(organizationId: string) {
  const query = usePeopleSyncStatus(organizationId)
  const actions = usePeopleSyncActions(organizationId)
  const status = isDirectorySyncAccessError(query.error) ? undefined : query.data
  const connect = (draft: SyncDraft, onConnected: () => void): SyncFieldErrors | null => {
    const parsed = peopleSyncConfigSchema.safeParse(
      draft.source === 'okta'
        ? { source: 'okta', domain: draft.domain, token: draft.token }
        : draft.source === 'entra'
          ? {
              source: 'entra',
              tenantId: draft.tenantId.trim(),
              clientId: draft.clientId.trim(),
              clientSecret: draft.clientSecret,
            }
          : { source: 'scim' }
    )
    if (!parsed.success) return flattenFieldErrors(parsed.error)
    actions.configure(parsed.data, onConnected)
    return null
  }
  return {
    loading: query.isPending,
    loaded: Boolean(status),
    loadError: query.isError && !status ? query.error : null,
    fetching: query.isFetching,
    retry: () => void query.refetch(),
    sync: status?.sync ?? null,
    pending: actions.pending,
    running: actions.action === 'run',
    actionError: actions.error,
    reset: actions.reset,
    run: actions.run,
    disconnect: actions.disconnect,
    connect,
  }
}
