import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import type { ConnectorSyncPayload } from '@/background/knowledge-connector-sync'

const logger = createLogger('BullMQKnowledgeConnectorSync')

export async function processKnowledgeConnectorSync(job: Job<BullMQJobData<ConnectorSyncPayload>>) {
  const { connectorId, fullSync } = job.data.payload
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing connector sync job', {
    jobId: job.id,
    connectorId,
  })

  return runDispatchedJob(job.data.metadata, () => executeSync(connectorId, { fullSync }), {
    isFinalAttempt,
  })
}
