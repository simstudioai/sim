import type {
  MothershipStreamV1TaskArmedPayload,
  MothershipStreamV1TaskDeliveredPayload,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'

/** Registration replay preserves any result already delivered for the same task. */
export function reduceTaskState(
  current: TaskBlockInfo | undefined,
  payload: MothershipStreamV1TaskArmedPayload | MothershipStreamV1TaskDeliveredPayload
): TaskBlockInfo | undefined {
  if (payload.kind === 'task_armed') {
    return (
      current ?? {
        taskId: payload.taskId,
        kind: payload.taskKind,
        target: payload.target,
        note: payload.note,
        status: 'pending',
      }
    )
  }
  return current ? { ...current, status: payload.status, summary: payload.summary } : undefined
}
