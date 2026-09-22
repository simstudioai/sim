import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { expect } from 'vitest'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'

/** Runs a connector's queued removal event until it completes, as the outbox worker would. */
export async function drainConnectorEvent(connectorId: string, eventType: string): Promise<void> {
  const [job] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, eventType),
        sql`${outboxEvent.payload}->>'connectorId' = ${connectorId}`
      )
    )
    .limit(1)
  expect(job).toBeDefined()
  let status = await processOutboxEventById(job.id, knowledgeDocumentProcessingOutboxHandlers)
  for (let attempt = 0; status === 'pending' && attempt < 20; attempt++) {
    await db.update(outboxEvent).set({ availableAt: new Date() }).where(eq(outboxEvent.id, job.id))
    status = await processOutboxEventById(job.id, knowledgeDocumentProcessingOutboxHandlers)
  }
  expect(status).toBe('completed')
}
