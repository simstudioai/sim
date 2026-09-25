import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getMothershipTaskStatusContract } from '@/lib/api/contracts/mothership-tasks'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'

export const MOTHERSHIP_TASK_STATUS_STALE_TIME = 10_000
export const mothershipTaskKeys = {
  all: ['mothership-task'] as const,
  details: () => [...mothershipTaskKeys.all, 'detail'] as const,
  detail: (taskId: string) => [...mothershipTaskKeys.details(), taskId] as const,
}

/** The transcript owns the task's label; the task service owns its changing status. */
export function useMothershipTaskStatus(task: TaskBlockInfo) {
  return useQuery({
    queryKey: mothershipTaskKeys.detail(task.taskId),
    queryFn: ({ signal }) =>
      requestJson(getMothershipTaskStatusContract, { params: { taskId: task.taskId }, signal }),
    enabled: task.status === undefined || task.status === 'pending',
    staleTime: MOTHERSHIP_TASK_STATUS_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'pending'
        ? false
        : MOTHERSHIP_TASK_STATUS_STALE_TIME,
  })
}
