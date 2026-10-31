import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  getPersonContract,
  importPeopleContract,
  listDepartmentsContract,
  listPeopleContract,
  type PersonBody,
  updatePersonContract,
} from '@/lib/api/contracts/people'

const PEOPLE_STALE_TIME = 60 * 1000

const peopleKeys = {
  all: ['people'] as const,
  organization: (organizationId: string) => [...peopleKeys.all, organizationId] as const,
  list: (organizationId: string, search: string, department: string) =>
    [...peopleKeys.organization(organizationId), 'list', search, department] as const,
  departments: (organizationId: string) =>
    [...peopleKeys.organization(organizationId), 'departments'] as const,
  person: (organizationId: string, memberId: string) =>
    [...peopleKeys.organization(organizationId), 'person', memberId] as const,
}

export function usePeople(organizationId: string, search: string, department: string) {
  return useInfiniteQuery({
    queryKey: peopleKeys.list(organizationId, search, department),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listPeopleContract, {
        params: { id: organizationId },
        query: {
          search: search || undefined,
          department: department || undefined,
          cursor: pageParam,
        },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: PEOPLE_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useDepartments(organizationId: string) {
  return useQuery({
    queryKey: peopleKeys.departments(organizationId),
    queryFn: ({ signal }) =>
      requestJson(listDepartmentsContract, { params: { id: organizationId }, signal }),
    select: (data) => data.departments,
    staleTime: PEOPLE_STALE_TIME,
  })
}

export function usePerson(organizationId: string, memberId: string) {
  return useQuery({
    queryKey: peopleKeys.person(organizationId, memberId),
    queryFn: ({ signal }) =>
      requestJson(getPersonContract, { params: { id: organizationId, memberId }, signal }),
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
  return useMutation({
    mutationFn: (body: { headers: string[]; rows: Record<string, string>[]; apply: boolean }) =>
      requestJson(importPeopleContract, { params: { id: organizationId }, body }),
    onSuccess: (result) => {
      if (result.applied) return invalidate()
    },
  })
}
