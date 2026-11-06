'use client'

import { useMemo, useState } from 'react'
import { useQueryStates } from 'nuqs'
import { isOrganizationSettingsSectionAvailable } from '@/components/settings/navigation'
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
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganization } from '@/lib/organizations/provider'
import { readPeopleSheet } from '@/lib/people/read-sheet'
import {
  boundedSearch,
  peopleParsers,
  peopleUrlKeys,
  serializePeopleView,
} from '@/lib/people/search-params'
import { memberProfileFieldsSchema } from '@/lib/people/validation'
import { saveBlob } from '@/lib/uploads/client/download'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useScimConnection } from '@/ee/scim/hooks/scim'
import { serializeSsoSettings } from '@/ee/sso/search-params'
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
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { isRefusal } from '@/platform/shared/query-view'

export type ChartBranch = ContractChartBranch
export type PeopleImportResult = ContractImportResult
export type Person = ContractPerson
export type PersonSummary = ContractPersonSummary
export type SyncStatus = PeopleSyncStatus
export type SyncSource = PeopleSyncConfig['source']

export const SYNC_SOURCE_NAMES: Record<SyncSource, string> = {
  okta: 'Okta',
  entra: 'Microsoft Entra ID',
  scim: 'SCIM provisioning',
}

/** Who is viewing, and which of the page's administration they may reach. */
export function usePeopleViewer() {
  const { organization, viewer, settingsFeatures } = useOrganization()
  const { features, hosted } = useDeploymentShape()
  return {
    organizationName: organization.name,
    isAdmin: viewer.isAdmin,
    canProvision: features.scim && (!hosted || settingsFeatures.hasEnterprisePlan),
    canOpenProvisioningSettings: isOrganizationSettingsSectionAvailable('sso', settingsFeatures),
    provisioningSettingsHref: serializeSsoSettings(
      organizationRoutes(organization.id).settingsSection('sso'),
      { tab: 'provisioning' }
    ),
  }
}

export function personHref(organizationId: string, memberId: string, originQuery = ''): string {
  return `${organizationRoutes(organizationId).person(memberId)}${originQuery}`
}

export function isApiConflict(error: unknown): boolean {
  return isApiClientError(error) && error.status === 409
}

export function usePeopleUrl() {
  return useQueryStates(peopleParsers, peopleUrlKeys)
}

type PeopleUrl = ReturnType<typeof usePeopleUrl>[0]
type PeopleUrlOverrides = { [Key in keyof PeopleUrl]?: PeopleUrl[Key] | null }

function profileOriginQuery(origin: PeopleUrl, overrides: PeopleUrlOverrides): string {
  return serializePeopleView({ ...origin, panel: null, ...overrides })
}

function peopleViewHref(
  organizationId: string,
  origin: PeopleUrl,
  overrides: PeopleUrlOverrides
): string {
  return serializePeopleView(organizationRoutes(organizationId).people, {
    ...origin,
    panel: null,
    ...overrides,
  })
}

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
    setSearch: (value: string) => setSearch(boundedSearch(value)),
    rows,
    hasDepartment,
    departmentLabel,
    originQuery: profileOriginQuery(origin, { view: 'directory' }),
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
  const options = useMemo(() => {
    const entries = waiting
      ? []
      : (departments.data?.pages.flatMap((page) => page.departments) ?? [])
    return [
      { value: ALL_DEPARTMENTS, label: 'All departments' },
      ...entries.map(({ name, count, departmentKey }) => ({
        value: departmentKey ? `${DEPARTMENT_KEY_PREFIX}${departmentKey}` : name,
        label: `${name} (${count})`,
      })),
    ]
  }, [waiting, departments.data])
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
      onQueryChange: (query: string) => setTerm(boundedSearch(query)),
      hasMore: !waiting && departments.hasNextPage,
      loading: waiting || departments.isFetching,
      error: waiting ? undefined : departments.error?.message,
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
  const debounced = useSearchFilterValue(term, SEARCH_DEBOUNCE_MS).trim()
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
      onQueryChange: (next: string) => setTerm(boundedSearch(next)),
      hasMore: query.hasNextPage && !waiting,
      loading: waiting || query.isFetching,
      error: waiting ? undefined : query.error?.message,
      onLoadMore: () => void query.fetchNextPage(),
      onRetry: () => void query.refetch(),
      emptyMessage:
        scope === 'roots' && !term.trim()
          ? 'No top-level teams with reporting lines yet'
          : 'No matching people',
    },
  }
}

const CHART_MAX_PAGE = 1_000_000

export function useOrgChart(organizationId: string) {
  const [origin, setView] = usePeopleUrl()
  const { focus, page } = origin
  const compact = useIsMobile()
  const size = compact ? 1 : 4
  const chart = usePeopleChart(
    organizationId,
    focus,
    Math.max(1, Math.min(page, CHART_MAX_PAGE)),
    size
  )
  const branch = isRefusal(chart.error) ? undefined : chart.data
  return {
    setView,
    focus,
    page,
    size,
    compact,
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

/** Whether any reporting line exists yet, and the first team to offer someone who has none. */
export function useChartRoots(organizationId: string, enabled = true) {
  const roots = usePeople(organizationId, '', '', { scope: 'roots', enabled })
  const firstTeam = roots.data?.pages[0]?.people[0]
  return {
    firstTeam,
    emptyOrganization: Boolean(roots.data) && !firstTeam,
    settled: !roots.isPending,
  }
}

export function usePersonProfile(organizationId: string, memberId: string) {
  const [origin] = usePeopleUrl()
  const query = usePerson(organizationId, memberId)
  const loadError = query.data && !isRefusal(query.error) ? null : query.error
  const data = loadError ? undefined : query.data
  const originView = origin.view ?? 'directory'
  return {
    data,
    error: loadError,
    retrying: query.isFetching,
    retry: () => void query.refetch(),
    originView,
    originQuery: profileOriginQuery(origin, { view: originView }),
    chartHref: peopleViewHref(organizationId, origin, {
      view: 'chart',
      focus: data?.person.memberId ?? memberId,
      page: origin.focus === data?.person.memberId ? origin.page : 1,
    }),
    departmentHref: peopleViewHref(organizationId, origin, {
      view: 'directory',
      search: '',
      department: data?.person.departmentKey ? null : data?.person.department,
      departmentKey: data?.person.departmentKey ?? null,
    }),
    backHref: peopleViewHref(organizationId, origin, { view: originView }),
    directoryHref: peopleViewHref(organizationId, origin, { view: 'directory' }),
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
      if (!parsed.success) return flattenFieldErrors<keyof PersonDraft & string>(parsed.error)
      await update.mutateAsync({ memberId, body: parsed.data })
      return null
    },
  }
}

export type ImportBody = PeopleImportBody

const IMPORT_TEMPLATE_CSV =
  'email,title,department,location,start_date,manager_email\nada@example.com,Engineer,Platform,Berlin,2024-01-31,grace@example.com\n'

export function downloadImportTemplate() {
  saveBlob(new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv' }), 'people-template.csv')
}

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

export interface SyncDraft {
  domain: string
  token: string
  tenantId: string
  clientId: string
  clientSecret: string
}

export type SyncFieldErrors = Partial<Record<keyof SyncDraft, string>>

/**
 * The connection as the page header reads it. Members never ask: its reads are admin-only. Reads
 * only the result, so a poll starting or settling doesn't re-render the page under it.
 */
export function useDirectorySyncStatus(organizationId: string, enabled: boolean) {
  const query = usePeopleSyncStatus(organizationId, enabled)
  const status = isDirectorySyncAccessError(query.error) ? undefined : query.data
  return { loaded: Boolean(status), settled: !query.isPending, sync: status?.sync ?? null }
}

/** The status with the action state machine the hook keeps out of the cache. */
export function useDirectorySync(organizationId: string) {
  const query = usePeopleSyncStatus(organizationId)
  const actions = usePeopleSyncActions(organizationId)
  const denied = isDirectorySyncAccessError(query.error)
  const status = denied ? undefined : query.data
  const connect = (
    source: SyncSource,
    draft: SyncDraft,
    onConnected: () => void
  ): SyncFieldErrors | null => {
    const parsed = peopleSyncConfigSchema.safeParse(
      source === 'okta'
        ? { source: 'okta', domain: draft.domain, token: draft.token }
        : source === 'entra'
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
    denied,
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
    /** Settles with the request, so a dialog can hold itself open as pending. */
    disconnect: () => new Promise<void>((resolve, reject) => actions.disconnect(resolve, reject)),
    connect,
  }
}
