import type { Job, JobStatus } from '@/lib/core/async-jobs/types'
import type { WorkspaceDispatchJobRecord } from '@/lib/core/workspace-dispatch/types'

export type DispatchPresentedStatus =
  | 'waiting'
  | 'admitting'
  | 'admitted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'queued'
  | JobStatus

export interface DispatchStatusPresentation {
  status: DispatchPresentedStatus
  metadata: {
    createdAt?: Date
    admittedAt?: Date
    startedAt?: Date
    completedAt?: Date
    queueName?: string
    lane?: string
    workspaceId?: string
    duration?: number
  }
  output?: unknown
  error?: string
  estimatedDuration?: number
}

export function presentDispatchOrJobStatus(
  dispatchJob: WorkspaceDispatchJobRecord | null,
  job: Job | null
): DispatchStatusPresentation {
  if (dispatchJob) {
    const startedAt = dispatchJob.startedAt ? new Date(dispatchJob.startedAt) : undefined
    const completedAt = dispatchJob.completedAt ? new Date(dispatchJob.completedAt) : undefined

    const response: DispatchStatusPresentation = {
      status: dispatchJob.status,
      metadata: {
        createdAt: new Date(dispatchJob.createdAt),
        admittedAt: dispatchJob.admittedAt ? new Date(dispatchJob.admittedAt) : undefined,
        startedAt,
        completedAt,
        queueName: dispatchJob.queueName,
        lane: dispatchJob.lane,
        workspaceId: dispatchJob.workspaceId,
      },
    }

    if (startedAt && completedAt) {
      response.metadata.duration = completedAt.getTime() - startedAt.getTime()
    }

    if (dispatchJob.status === 'completed') {
      response.output = dispatchJob.output
    }

    if (dispatchJob.status === 'failed') {
      response.error = dispatchJob.error
    }

    if (
      dispatchJob.status === 'waiting' ||
      dispatchJob.status === 'admitting' ||
      dispatchJob.status === 'admitted' ||
      dispatchJob.status === 'running'
    ) {
      response.estimatedDuration = 300000
    }

    return response
  }

  if (!job) {
    return {
      status: 'queued',
      metadata: {},
    }
  }

  const mappedStatus = job.status === 'pending' ? 'queued' : job.status
  const response: DispatchStatusPresentation = {
    status: mappedStatus,
    metadata: {
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  }

  if (job.startedAt && job.completedAt) {
    response.metadata.duration = job.completedAt.getTime() - job.startedAt.getTime()
  }

  if (job.status === 'completed') {
    response.output = job.output
  }

  if (job.status === 'failed') {
    response.error = job.error
  }

  if (job.status === 'processing' || job.status === 'pending') {
    response.estimatedDuration = 300000
  }

  return response
}
