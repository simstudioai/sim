'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useOrganizationAccountPeople } from '@/hooks/queries/organization-account-management'
import {
  type CredentialGroupPeople,
  type CredentialGroupPerson,
  toCredentialGroupPerson,
} from '@/platform/lib/data/models/connected-accounts'

/** Credential groups' views, in the URL's `tab`. */
export const credentialGroupTabParser = parseAsStringLiteral([
  'providers',
  'people',
  'workspace-access',
] as const).withDefault('providers')

/** The People tab's search, in the URL. It filters on the client or in the live read, never both. */
export function useCredentialGroupPeopleSearch() {
  return useQueryState('credential-group-people', parseAsString.withDefault(''))
}

/** The live roster, a page at a time, matching the URL's search. */
export function useLiveCredentialGroupPeople(
  organizationId: string,
  enabled: boolean
): CredentialGroupPeople {
  const [search] = useCredentialGroupPeopleSearch()
  const people = useOrganizationAccountPeople(organizationId, search.trim(), enabled)
  return {
    rows: (people.data?.pages.flatMap((page) => page.enrollments) ?? []).map(
      toCredentialGroupPerson
    ),
    pending: people.isPending,
    failure:
      people.isError && !people.data
        ? {
            message: getErrorMessage(people.error, 'Failed to load people'),
            retry: () => void people.refetch(),
          }
        : null,
    loadMore: {
      hasMore: people.hasNextPage && !people.isPlaceholderData,
      loading: people.isFetchingNextPage,
      error: people.isFetchNextPageError ? 'Failed to load more people' : undefined,
      onLoadMore: () => void people.fetchNextPage(),
    },
  }
}

/** The example's whole roster, filtered by the URL's search. */
export function useFixtureCredentialGroupPeople(
  people: readonly CredentialGroupPerson[]
): CredentialGroupPeople {
  const [search] = useCredentialGroupPeopleSearch()
  const query = search.trim().toLowerCase()
  return {
    rows: people.filter((person) => person.email.toLowerCase().includes(query)),
    pending: false,
    failure: null,
  }
}
