import { useRef } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  getPeopleChartContract,
  getPersonContract,
  importPeopleContract,
  listDepartmentsContract,
  listPeopleContract,
  type PeopleImportBody,
  type PersonBody,
  updatePersonContract,
} from '@/lib/api/contracts/people'

const PEOPLE_STALE_TIME = 60 * 1000
const VISIBLE_PROFILE_REFRESH_MS = 5 * 60_000

export const peopleKeys = {
  all: ['people'] as const,
  organization: (organizationId: string) => [...peopleKeys.all, organizationId] as const,
  list: (
    organizationId: string,
    search: string,
    department: string,
    scope?: 'roots' | 'members',
    departmentKey?: string
  ) =>
    [
      ...peopleKeys.organization(organizationId),
      'list',
      scope,
      search,
      department,
      departmentKey,
    ] as const,
  chart: (organizationId: string, memberId: string, page: number, size: number) =>
    [...peopleKeys.organization(organizationId), 'chart', memberId, page, size] as const,
  departments: (organizationId: string, search: string) =>
    [...peopleKeys.organization(organizationId), 'departments', search] as const,
  person: (organizationId: string, memberId: string) =>
    [...peopleKeys.organization(organizationId), 'person', memberId] as const,
}

export function usePeople(
  organizationId: string,
  search: string,
  department: string,
  options: { scope?: 'roots' | 'members'; enabled?: boolean; departmentKey?: string } = {}
) {
  return useInfiniteQuery({
    queryKey: peopleKeys.list(
      organizationId,
      search,
      department,
      options.scope,
      options.departmentKey
    ),
    enabled: options.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listPeopleContract, {
        params: { id: organizationId },
        query: {
          scope: options.scope,
          search: search || undefined,
          department: options.departmentKey ? undefined : department || undefined,
          departmentKey: options.departmentKey || undefined,
          cursor: pageParam,
        },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: PEOPLE_STALE_TIME,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === organizationId && query.queryKey[3] === options.scope
        ? previous
        : undefined,
  })
}

export function usePeopleChart(
  organizationId: string,
  memberId: string,
  page: number,
  size: number
) {
  return useQuery({
    queryKey: peopleKeys.chart(organizationId, memberId, page, size),
    queryFn: ({ signal }) =>
      requestJson(getPeopleChartContract, {
        params: { id: organizationId },
        query: { memberId: memberId || undefined, page, size },
        signal,
      }),
    refetchInterval: VISIBLE_PROFILE_REFRESH_MS,
    retry: (failures, error) => !(isApiClientError(error) && error.status === 404) && failures < 1,
    staleTime: PEOPLE_STALE_TIME,
  })
}

export function useDepartments(organizationId: string, search: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: peopleKeys.departments(organizationId, search),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listDepartmentsContract, {
        params: { id: organizationId },
        query: { search: search || undefined, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: PEOPLE_STALE_TIME,
  })
}

export function usePerson(organizationId: string, memberId: string) {
  return useQuery({
    queryKey: peopleKeys.person(organizationId, memberId),
    queryFn: ({ signal }) =>
      requestJson(getPersonContract, { params: { id: organizationId, memberId }, signal }),
    refetchInterval: VISIBLE_PROFILE_REFRESH_MS,
    retry: (failures, error) => !(isApiClientError(error) && error.status === 404) && failures < 1,
    staleTime: PEOPLE_STALE_TIME,
  })
}

/** A profile change can move anyone's manager, reports, or department, so it refreshes them all. */
function useInvalidatePeople(organizationId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: peopleKeys.organization(organizationId) })
}

export function useUpdatePerson(organizationId: string) {
  const invalidate = useInvalidatePeople(organizationId)
  return useMutation({
    mutationFn: ({ memberId, body }: { memberId: string; body: PersonBody }) =>
      requestJson(updatePersonContract, { params: { id: organizationId, memberId }, body }),
    onSuccess: invalidate,
  })
}

export function useImportPeople(organizationId: string) {
  const invalidate = useInvalidatePeople(organizationId)
  // Provider tokens must never enter the mutation cache or its devtools.
  const nextRequest = useRef<PeopleImportBody | null>(null)
  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    mutationFn: () => {
      const body = nextRequest.current
      nextRequest.current = null
      if (!body) throw new Error('Choose an import source')
      return requestJson(importPeopleContract, { params: { id: organizationId }, body })
    },
    onSuccess: (result) => {
      if (result.applied) return invalidate()
    },
  })
  return {
    submit: (body: PeopleImportBody) => {
      nextRequest.current = body
      return mutation.mutateAsync()
    },
    isPending: mutation.isPending,
  }
}
