import { WebhookData } from '@/lib/types'
import { db } from '@/db'
import { workflow_logs } from '@/db/schema'

export interface LogEntry {
  id: string
  workflowId: string
  executionId: string
  level: string
  message: string
  createdAt: Date
  duration?: string
  trigger?: string
  webhookData?: WebhookData
}

export async function persistLog(log: LogEntry) {
  await db.insert(workflow_logs).values(log)
}
