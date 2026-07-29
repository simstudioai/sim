import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateNewsletterRunBody,
  createNewsletterRunContract,
  finalizeNewsletterRunContract,
  getNewsletterRunContract,
  getNewsletterRunJobContract,
  listNewsletterRunsContract,
  pushNewsletterRunToResendContract,
} from '@/lib/api/contracts/newsletters'

export const NEWSLETTER_RUN_LIST_STALE_TIME = 30 * 1000
export const NEWSLETTER_RUN_DETAIL_STALE_TIME = 10 * 1000
export const NEWSLETTER_JOB_STALE_TIME = 3 * 1000

export const newsletterKeys = {
  all: ['newsletters'] as const,
  lists: () => [...newsletterKeys.all, 'list'] as const,
  list: () => [...newsletterKeys.lists()] as const,
  details: () => [...newsletterKeys.all, 'detail'] as const,
  detail: (id?: string) => [...newsletterKeys.details(), id ?? ''] as const,
  jobs: () => [...newsletterKeys.all, 'job'] as const,
  job: (id?: string) => [...newsletterKeys.jobs(), id ?? ''] as const,
}

export function useNewsletterRuns() {
  return useQuery({
    queryKey: newsletterKeys.list(),
    queryFn: ({ signal }) =>
      requestJson(listNewsletterRunsContract, { query: { limit: 25, offset: 0 }, signal }),
    staleTime: NEWSLETTER_RUN_LIST_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.status === 'pushing')
        ? NEWSLETTER_JOB_STALE_TIME
        : false,
  })
}

export function useNewsletterRun(id?: string) {
  return useQuery({
    queryKey: newsletterKeys.detail(id),
    queryFn: ({ signal }) =>
      requestJson(getNewsletterRunContract, { params: { id: id as string }, signal }),
    enabled: Boolean(id),
    staleTime: NEWSLETTER_RUN_DETAIL_STALE_TIME,
  })
}

export function useNewsletterJob(id?: string, enabled = false) {
  return useQuery({
    queryKey: newsletterKeys.job(id),
    queryFn: ({ signal }) =>
      requestJson(getNewsletterRunJobContract, { params: { id: id as string }, signal }),
    enabled: Boolean(id) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status
      return enabled && (status === 'pending' || status === 'processing')
        ? NEWSLETTER_JOB_STALE_TIME
        : false
    },
    staleTime: NEWSLETTER_JOB_STALE_TIME,
  })
}

export function useCreateNewsletterRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateNewsletterRunBody) =>
      requestJson(createNewsletterRunContract, { body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() })
    },
  })
}

export function useFinalizeNewsletterRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => requestJson(finalizeNewsletterRunContract, { params: { id } }),
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() })
      queryClient.invalidateQueries({ queryKey: newsletterKeys.detail(id) })
    },
  })
}

export function usePushNewsletterRunToResend() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => requestJson(pushNewsletterRunToResendContract, { params: { id } }),
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() })
      queryClient.invalidateQueries({ queryKey: newsletterKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: newsletterKeys.job(id) })
    },
  })
}
