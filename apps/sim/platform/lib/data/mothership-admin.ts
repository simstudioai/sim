import type { QueryClient } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import {
  type MothershipEnv,
  mothershipKeys,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipUserBreakdown,
} from '@/hooks/queries/mothership-admin'
import { queryView } from '@/platform/shared/query-view'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

export type { MothershipEnv }

export const MOTHERSHIP_ENVIRONMENTS = [
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
] as const

export const MOTHERSHIP_VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'licenses', label: 'Licenses' },
  { value: 'byok', label: 'BYOK' },
] as const

const parameters = {
  tab: parseAsStringLiteral(['overview', 'licenses', 'byok']).withDefault('overview'),
  env: parseAsStringLiteral(['dev', 'staging', 'prod', 'default']).withDefault('dev'),
  /** The page of recent requests, from 1. */
  page: parseAsInteger.withDefault(1),
  /** The recent request whose details are open. */
  request: parseAsString.withDefault(''),
  /**
   * The reporting period's UTC minutes (`yyyy-MM-ddTHH:mm`). Nullable: the default is the week
   * before the page opened, a moving value the panel derives.
   */
  start: parseAsString,
  end: parseAsString,
}

/** A reporting period in UTC minutes, as the range picker edits it. */
export interface MothershipRange {
  start: string
  end: string
}

/**
 * The Mothership tab's view: which tab and environment, the reporting period, and the page and
 * request open in Overview. Changing what Overview reports returns it to its first page.
 */
export function useMothershipView() {
  const [params, setParams] = useQueryStates(parameters, {
    history: 'replace',
    clearOnDefault: true,
  })
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  return {
    ...params,
    change: (next: Partial<Pick<typeof params, 'tab' | 'env'>>) =>
      requestLeave(() => void setParams({ ...next, page: null, request: null })),
    setRange: (range: MothershipRange) => void setParams({ ...range, page: null, request: null }),
    setPage: (page: number) => void setParams({ page, request: null }),
    openRequest: (request: string) => void setParams({ request }, { history: 'push' }),
    closeRequest: () => void setParams({ request: null }, { history: 'replace' }),
  }
}

export interface LicenseDraft {
  name: string
  approvalReference: string
  expirationDate: string | null
}

/** A read as the panel shows it: another period's rows never stand in for this one's. */
function readResponse<T>(
  query: Parameters<typeof queryView>[0] & { data: T | undefined; isPlaceholderData: boolean }
) {
  const view = queryView(query)
  if (query.isPlaceholderData) return { ...view, data: undefined, status: 'pending' as const }
  return { ...view, data: view.status === 'success' ? query.data : undefined }
}

export function useMothershipOverview(env: MothershipEnv, start: string, end: string) {
  const summary = useMothershipUserBreakdown(env, start, end)
  const recent = useMothershipRequests(env, start, end)
  return { breakdown: readResponse(summary), requests: readResponse(recent) }
}

export function refreshMothershipLicenses(client: QueryClient, env: MothershipEnv) {
  return client.invalidateQueries({ queryKey: mothershipKeys.licenses(env) })
}

/** The account settings tab that generates a license for `env`. */
export function licenseGeneratorHref(env: MothershipEnv) {
  return `/account/settings/mothership?tab=licenses&env=${encodeURIComponent(env)}`
}

export function useLicenseList(env: MothershipEnv) {
  return readResponse(useMothershipLicenses(env))
}
