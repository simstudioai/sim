import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getMothershipTaskStatusContract } from '@/lib/api/contracts/mothership-tasks'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'

/** The transcript owns the task's label; the task service owns its changing status. */
export function useMothershipTaskStatus(task: TaskBlockInfo) {
  return useQuery({
    queryKey: ['mothership-task', task.taskId],
    queryFn: ({ signal }) =>
      requestJson(getMothershipTaskStatusContract, { params: { taskId: task.taskId }, signal }),
    enabled: task.status === undefined || task.status === 'pending',
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'pending' ? false : 10_000,
  })
}
