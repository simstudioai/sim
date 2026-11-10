import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationHomeCalendarContract,
  getOrganizationHomeEmailContract,
} from '@/lib/api/contracts/organization-home'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'

/** Each read costs a request per thread at the member's mail provider, so focus re-reads are spaced. */
const EMAIL_STALE_TIME = 5 * 60 * 1000
/** A day's meetings change less often than a mailbox, and every day browsed is its own read. */
const CALENDAR_STALE_TIME = 5 * 60 * 1000

/** Nested under the organization's accounts, so anything that changes a connection refreshes Home. */
const organizationHomeKeys = {
  all: organizationAccountsKeys.all,
  organization: (organizationId: string) =>
    [...organizationAccountsKeys.detail(organizationId), 'home'] as const,
  email: (organizationId: string) =>
    [...organizationHomeKeys.organization(organizationId), 'email'] as const,
  calendar: (organizationId: string, date: string, timeZone: string) =>
    [...organizationHomeKeys.organization(organizationId), 'calendar', date, timeZone] as const,
}

interface HomeWidgetQueryOptions {
  enabled: boolean
}

/** Refreshes on focus once stale, in place of polling: the person is back to look at it. */
export function useOrganizationHomeEmail(
  organizationId: string,
  { enabled }: HomeWidgetQueryOptions
) {
  return useQuery({
    queryKey: organizationHomeKeys.email(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationHomeEmailContract, { params: { id: organizationId }, signal }),
    enabled,
    staleTime: EMAIL_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}

export function useOrganizationHomeCalendar(
  organizationId: string,
  date: string,
  timeZone: string,
  { enabled }: HomeWidgetQueryOptions
) {
  return useQuery({
    queryKey: organizationHomeKeys.calendar(organizationId, date, timeZone),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationHomeCalendarContract, {
        params: { id: organizationId },
        query: { date, timeZone },
        signal,
      }),
    enabled,
    staleTime: CALENDAR_STALE_TIME,
    refetchOnWindowFocus: true,
  })
}
