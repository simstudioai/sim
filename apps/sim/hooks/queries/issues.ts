import { toast } from '@sim/emcn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  addIssueCommentContract,
  addIssueResourceContract,
  approveIssueContract,
  type CloseIssueBody,
  type CreateIssueBody,
  closeIssueContract,
  createIssueContract,
  deleteIssueCommentContract,
  getIssueContract,
  listIssuesContract,
  removeIssueResourceContract,
  reopenIssueContract,
  requestIssueChangesContract,
  startIssueContract,
  type UpdateIssueBody,
  updateIssueContract,
} from '@/lib/api/contracts/issues'
import type { IssueResourceType } from '@/lib/issues/types'

const ISSUE_LIST_STALE_TIME = 15_000
const ISSUE_DETAIL_STALE_TIME = 15_000
/** While Sim works on the issue, so the page follows its run and notices a detached chat. */
const ISSUE_RUNNING_REFETCH_INTERVAL = 10_000

export const issueKeys = {
  all: ['issues'] as const,
  lists: () => [...issueKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...issueKeys.lists(), workspaceId] as const,
  details: () => [...issueKeys.all, 'detail'] as const,
  detail: (workspaceId: string, key: string) => [...issueKeys.details(), workspaceId, key] as const,
}

interface UseIssueListOptions {
  enabled?: boolean
  /** Refetch while any issue is in progress, so a page left open sees Sim hand work back. */
  followProgress?: boolean
}

export function useIssueList(workspaceId: string, options?: UseIssueListOptions) {
  return useQuery({
    queryKey: issueKeys.list(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listIssuesContract, { params: { id: workspaceId }, signal }),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: ISSUE_LIST_STALE_TIME,
    refetchInterval: (query) =>
      options?.followProgress &&
      query.state.data?.issues.some((issue) => issue.status === 'in_progress')
        ? ISSUE_RUNNING_REFETCH_INTERVAL
        : false,
    select: (data) => data.issues,
  })
}

export function useIssue(workspaceId: string, key: string) {
  return useQuery({
    queryKey: issueKeys.detail(workspaceId, key),
    queryFn: ({ signal }) =>
      requestJson(getIssueContract, { params: { id: workspaceId, key }, signal }),
    enabled: Boolean(workspaceId && key),
    staleTime: ISSUE_DETAIL_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.issue.status === 'in_progress' ? ISSUE_RUNNING_REFETCH_INTERVAL : false,
  })
}

function useInvalidateIssue() {
  const queryClient = useQueryClient()
  return (workspaceId: string, key: string) => {
    queryClient.invalidateQueries({ queryKey: issueKeys.list(workspaceId) })
    queryClient.invalidateQueries({ queryKey: issueKeys.detail(workspaceId, key) })
  }
}

export function useCreateIssue(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateIssueBody) =>
      requestJson(createIssueContract, { params: { id: workspaceId }, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: issueKeys.list(workspaceId) }),
  })
}

interface IssueTarget {
  workspaceId: string
  key: string
}

export function useUpdateIssue() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key, ...body }: IssueTarget & UpdateIssueBody) =>
      requestJson(updateIssueContract, { params: { id: workspaceId, key }, body }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useStartIssue() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key, chatId }: IssueTarget & { chatId: string }) =>
      requestJson(startIssueContract, { params: { id: workspaceId, key }, body: { chatId } }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useApproveIssue() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key }: IssueTarget) =>
      requestJson(approveIssueContract, { params: { id: workspaceId, key } }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useRequestIssueChanges() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key, note }: IssueTarget & { note?: string }) =>
      requestJson(requestIssueChangesContract, {
        params: { id: workspaceId, key },
        body: { note },
      }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useCloseIssue() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key, ...body }: IssueTarget & CloseIssueBody) =>
      requestJson(closeIssueContract, { params: { id: workspaceId, key }, body }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useReopenIssue() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key }: IssueTarget) =>
      requestJson(reopenIssueContract, { params: { id: workspaceId, key } }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

/** Links or unlinks a workspace resource from an issue. */
export function useToggleIssueResource() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({
      workspaceId,
      key,
      type,
      resourceId,
      unlink,
    }: IssueTarget & { type: IssueResourceType; resourceId: string; unlink: boolean }) =>
      requestJson(unlink ? removeIssueResourceContract : addIssueResourceContract, {
        params: { id: workspaceId, key },
        body: { type, resourceId },
      }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useAddIssueComment() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key, body }: IssueTarget & { body: string }) =>
      requestJson(addIssueCommentContract, { params: { id: workspaceId, key }, body: { body } }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
  })
}

export function useDeleteIssueComment() {
  const invalidate = useInvalidateIssue()
  return useMutation({
    mutationFn: ({ workspaceId, key, commentId }: IssueTarget & { commentId: string }) =>
      requestJson(deleteIssueCommentContract, { params: { id: workspaceId, key, commentId } }),
    onSuccess: (_data, { workspaceId, key }) => invalidate(workspaceId, key),
    onError: (error) => toast.error("Couldn't delete the comment", { description: error.message }),
  })
}
