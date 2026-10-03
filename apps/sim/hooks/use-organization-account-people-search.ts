'use client'

import { useQueryState } from 'nuqs'
import {
  credentialGroupPeopleSearchParam,
  credentialGroupPeopleSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

/** Keeps account filtering stable across setup, loading, and populated views. */
export function useOrganizationAccountPeopleSearch(): [string, (value: string) => void] {
  const [search, setSearch] = useQueryState(credentialGroupPeopleSearchParam.key, {
    ...credentialGroupPeopleSearchParam.parser,
    ...credentialGroupPeopleSearchUrlKeys,
  })
  return [search, useDebouncedSearchSetter(setSearch)]
}
