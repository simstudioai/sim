import { createLogger } from '@sim/logger'
import type { Job } from 'bullmq'
import type { BullMQJobData } from '@/lib/core/bullmq'
import { runDispatchedJob } from '@/lib/core/workspace-dispatch'
import { type DocumentJobData, processDocumentAsync } from '@/lib/knowledge/documents/service'

const logger = createLogger('BullMQKnowledgeDocumentProcessing')

export async function processKnowledgeDocument(job: Job<BullMQJobData<DocumentJobData>>) {
  const { knowledgeBaseId, documentId, docData, processingOptions } = job.data.payload
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

  logger.info('Processing knowledge document job', {
    jobId: job.id,
    knowledgeBaseId,
    documentId,
  })

  await runDispatchedJob(
    job.data.metadata,
    () => processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions),
    {
      isFinalAttempt,
    }
  )
}
