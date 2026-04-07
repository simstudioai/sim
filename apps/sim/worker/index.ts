import { createLogger } from '@sim/logger'
import { Worker } from 'bullmq'
import {
  getBullMQConnectionOptions,
  isBullMQEnabled,
  KNOWLEDGE_CONNECTOR_SYNC_QUEUE,
  KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE,
  MOTHERSHIP_JOB_EXECUTION_QUEUE,
  WORKSPACE_NOTIFICATION_DELIVERY_QUEUE,
} from '@/lib/core/bullmq'
import { wakeWorkspaceDispatcher } from '@/lib/core/workspace-dispatch'
import { sweepPendingNotificationDeliveries } from '@/background/workspace-notification-delivery'
import { startWorkerHealthServer, updateWorkerHealthState } from '@/worker/health'
import { processKnowledgeConnectorSync } from '@/worker/processors/knowledge-connector-sync'
import { processKnowledgeDocument } from '@/worker/processors/knowledge-document-processing'
import { processMothershipJobExecution } from '@/worker/processors/mothership-job-execution'
import { processSchedule } from '@/worker/processors/schedule'
import { processWebhook } from '@/worker/processors/webhook'
import { processWorkflow } from '@/worker/processors/workflow'
import { processWorkspaceNotificationDelivery } from '@/worker/processors/workspace-notification-delivery'

const logger = createLogger('BullMQWorker')

const DEFAULT_WORKER_PORT = 3001
const DEFAULT_WORKFLOW_CONCURRENCY = 50
const DEFAULT_WEBHOOK_CONCURRENCY = 30
const DEFAULT_SCHEDULE_CONCURRENCY = 20
const DEFAULT_MOTHERSHIP_JOB_CONCURRENCY = 10
const DEFAULT_CONNECTOR_SYNC_CONCURRENCY = 5
const DEFAULT_DOCUMENT_PROCESSING_CONCURRENCY = 20
const DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY = 10
const DISPATCHER_WAKE_INTERVAL_MS = 5_000
const NOTIFICATION_SWEEPER_INTERVAL_MS = 10_000

function parseWorkerNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main() {
  const workerPort = parseWorkerNumber(process.env.WORKER_PORT, DEFAULT_WORKER_PORT)
  const healthServer = startWorkerHealthServer(workerPort)

  if (!isBullMQEnabled()) {
    logger.warn('BullMQ worker started without REDIS_URL; worker will remain idle')

    const shutdownWithoutRedis = async () => {
      await healthServer.close()
      process.exit(0)
    }

    process.on('SIGINT', shutdownWithoutRedis)
    process.on('SIGTERM', shutdownWithoutRedis)
    return
  }

  const connection = getBullMQConnectionOptions()

  const workflowWorker = new Worker('workflow-execution', processWorkflow, {
    connection,
    concurrency: parseWorkerNumber(
      process.env.WORKER_CONCURRENCY_WORKFLOW,
      DEFAULT_WORKFLOW_CONCURRENCY
    ),
  })

  const webhookWorker = new Worker('webhook-execution', processWebhook, {
    connection,
    concurrency: parseWorkerNumber(
      process.env.WORKER_CONCURRENCY_WEBHOOK,
      DEFAULT_WEBHOOK_CONCURRENCY
    ),
  })

  const scheduleWorker = new Worker('schedule-execution', processSchedule, {
    connection,
    concurrency: parseWorkerNumber(
      process.env.WORKER_CONCURRENCY_SCHEDULE,
      DEFAULT_SCHEDULE_CONCURRENCY
    ),
  })

  const mothershipJobWorker = new Worker(
    MOTHERSHIP_JOB_EXECUTION_QUEUE,
    processMothershipJobExecution,
    {
      connection,
      concurrency: parseWorkerNumber(
        process.env.WORKER_CONCURRENCY_MOTHERSHIP_JOB,
        DEFAULT_MOTHERSHIP_JOB_CONCURRENCY
      ),
    }
  )

  const connectorSyncWorker = new Worker(
    KNOWLEDGE_CONNECTOR_SYNC_QUEUE,
    processKnowledgeConnectorSync,
    {
      connection,
      concurrency: parseWorkerNumber(
        process.env.WORKER_CONCURRENCY_CONNECTOR_SYNC,
        DEFAULT_CONNECTOR_SYNC_CONCURRENCY
      ),
    }
  )

  const documentProcessingWorker = new Worker(
    KNOWLEDGE_DOCUMENT_PROCESSING_QUEUE,
    processKnowledgeDocument,
    {
      connection,
      concurrency: parseWorkerNumber(
        process.env.WORKER_CONCURRENCY_DOCUMENT_PROCESSING,
        DEFAULT_DOCUMENT_PROCESSING_CONCURRENCY
      ),
    }
  )

  const notificationDeliveryWorker = new Worker(
    WORKSPACE_NOTIFICATION_DELIVERY_QUEUE,
    processWorkspaceNotificationDelivery,
    {
      connection,
      concurrency: parseWorkerNumber(
        process.env.WORKER_CONCURRENCY_NOTIFICATION_DELIVERY,
        DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY
      ),
    }
  )

  const workers = [
    workflowWorker,
    webhookWorker,
    scheduleWorker,
    mothershipJobWorker,
    connectorSyncWorker,
    documentProcessingWorker,
    notificationDeliveryWorker,
  ]

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.error('BullMQ job failed', {
        queue: worker.name,
        jobId: job?.id,
        name: job?.name,
        error: error.message,
      })
    })
  }

  const dispatcherWakeInterval = setInterval(() => {
    void wakeWorkspaceDispatcher()
      .then(() => {
        updateWorkerHealthState({ dispatcherLastWakeAt: Date.now() })
      })
      .catch((error) => {
        logger.error('Periodic workspace dispatcher wake failed', { error })
      })
  }, DISPATCHER_WAKE_INTERVAL_MS)
  dispatcherWakeInterval.unref()

  const notificationSweeperInterval = setInterval(() => {
    void sweepPendingNotificationDeliveries().catch((error) => {
      logger.error('Pending notification sweeper failed', { error })
    })
  }, NOTIFICATION_SWEEPER_INTERVAL_MS)
  notificationSweeperInterval.unref()

  const shutdown = async () => {
    logger.info('Shutting down BullMQ worker')

    clearInterval(dispatcherWakeInterval)
    clearInterval(notificationSweeperInterval)
    await Promise.allSettled(workers.map((worker) => worker.close()))
    await healthServer.close()

    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  logger.error('Failed to start BullMQ worker', {
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
