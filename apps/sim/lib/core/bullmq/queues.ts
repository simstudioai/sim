import { Queue, QueueEvents } from 'bullmq'
import type { JobMetadata, JobType } from '@/lib/core/async-jobs/types'
import { getBullMQConnectionOptions } from '@/lib/core/bullmq/connection'
import type { WorkspaceDispatchQueueName } from '@/lib/core/workspace-dispatch/types'

export const KNOWLEDGE_CONNECTOR_SYNC_QUEUE = 'knowledge-connector-sync' as const
export const KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE = 'knowledge-process-document' as const
export const MOTHERSHIP_JOB_EXECUTION_QUEUE = 'mothership-job-execution' as const
export const WORKSPACE_NOTIFICATION_DELIVERY_QUEUE = 'workspace-notification-delivery' as const

export interface BullMQJobData<TPayload> {
  payload: TPayload
  metadata?: JobMetadata
}

let workflowQueueInstance: Queue | null = null
let webhookQueueInstance: Queue | null = null
let scheduleQueueInstance: Queue | null = null
let knowledgeConnectorSyncQueueInstance: Queue | null = null
let knowledgeDocumentProcessingQueueInstance: Queue | null = null
let mothershipJobExecutionQueueInstance: Queue | null = null
let workspaceNotificationDeliveryQueueInstance: Queue | null = null
let workflowQueueEventsInstance: QueueEvents | null = null

function getQueueDefaultOptions(type: JobType) {
  switch (type) {
    case 'workflow-execution':
      return {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 1000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      }
    case 'webhook-execution':
      return {
        attempts: 2,
        backoff: { type: 'exponential' as const, delay: 2000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 3 * 24 * 60 * 60 },
      }
    case 'schedule-execution':
      return {
        attempts: 2,
        backoff: { type: 'exponential' as const, delay: 5000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 3 * 24 * 60 * 60 },
      }
  }
}

function createQueue(type: JobType): Queue {
  return new Queue(type, {
    connection: getBullMQConnectionOptions(),
    defaultJobOptions: getQueueDefaultOptions(type),
  })
}

function createNamedQueue(
  name:
    | typeof KNOWLEDGE_CONNECTOR_SYNC_QUEUE
    | typeof KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE
    | typeof MOTHERSHIP_JOB_EXECUTION_QUEUE
    | typeof WORKSPACE_NOTIFICATION_DELIVERY_QUEUE
): Queue {
  switch (name) {
    case KNOWLEDGE_CONNECTOR_SYNC_QUEUE:
      return new Queue(name, {
        connection: getBullMQConnectionOptions(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      })
    case KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE:
      return new Queue(name, {
        connection: getBullMQConnectionOptions(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      })
    case MOTHERSHIP_JOB_EXECUTION_QUEUE:
      return new Queue(name, {
        connection: getBullMQConnectionOptions(),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      })
    case WORKSPACE_NOTIFICATION_DELIVERY_QUEUE:
      return new Queue(name, {
        connection: getBullMQConnectionOptions(),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      })
  }
}

export function getBullMQQueue(type: JobType): Queue {
  switch (type) {
    case 'workflow-execution':
      if (!workflowQueueInstance) {
        workflowQueueInstance = createQueue(type)
      }
      return workflowQueueInstance
    case 'webhook-execution':
      if (!webhookQueueInstance) {
        webhookQueueInstance = createQueue(type)
      }
      return webhookQueueInstance
    case 'schedule-execution':
      if (!scheduleQueueInstance) {
        scheduleQueueInstance = createQueue(type)
      }
      return scheduleQueueInstance
  }
}

export function getBullMQQueueByName(queueName: WorkspaceDispatchQueueName): Queue {
  switch (queueName) {
    case 'workflow-execution':
    case 'webhook-execution':
    case 'schedule-execution':
      return getBullMQQueue(queueName)
    case KNOWLEDGE_CONNECTOR_SYNC_QUEUE:
      return getKnowledgeConnectorSyncQueue()
    case KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE:
      return getKnowledgeDocumentProcessingQueue()
    case MOTHERSHIP_JOB_EXECUTION_QUEUE:
      return getMothershipJobExecutionQueue()
    case WORKSPACE_NOTIFICATION_DELIVERY_QUEUE:
      return getWorkspaceNotificationDeliveryQueue()
  }
}

export function getWorkflowQueueEvents(): QueueEvents {
  if (!workflowQueueEventsInstance) {
    workflowQueueEventsInstance = new QueueEvents('workflow-execution', {
      connection: getBullMQConnectionOptions(),
    })
  }

  return workflowQueueEventsInstance
}

export function getKnowledgeConnectorSyncQueue(): Queue {
  if (!knowledgeConnectorSyncQueueInstance) {
    knowledgeConnectorSyncQueueInstance = createNamedQueue(KNOWLEDGE_CONNECTOR_SYNC_QUEUE)
  }

  return knowledgeConnectorSyncQueueInstance
}

export function getKnowledgeDocumentProcessingQueue(): Queue {
  if (!knowledgeDocumentProcessingQueueInstance) {
    knowledgeDocumentProcessingQueueInstance = createNamedQueue(KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE)
  }

  return knowledgeDocumentProcessingQueueInstance
}

export function getMothershipJobExecutionQueue(): Queue {
  if (!mothershipJobExecutionQueueInstance) {
    mothershipJobExecutionQueueInstance = createNamedQueue(MOTHERSHIP_JOB_EXECUTION_QUEUE)
  }

  return mothershipJobExecutionQueueInstance
}

export function getWorkspaceNotificationDeliveryQueue(): Queue {
  if (!workspaceNotificationDeliveryQueueInstance) {
    workspaceNotificationDeliveryQueueInstance = createNamedQueue(
      WORKSPACE_NOTIFICATION_DELIVERY_QUEUE
    )
  }

  return workspaceNotificationDeliveryQueueInstance
}

export function createBullMQJobData<TPayload>(
  payload: TPayload,
  metadata?: JobMetadata
): BullMQJobData<TPayload> {
  return {
    payload,
    metadata: metadata ?? {},
  }
}
