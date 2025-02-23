import { db } from '@/db'
import { workflowLogs } from '@/db/schema'

export interface LogEntry {
  id: string
  workflowId: string
  executionId: string
  level: string
  message: string
  createdAt: Date
  duration?: string
  trigger?: string
}

export async function persistLog(log: LogEntry) {
  await db.insert(workflowLogs).values(log)
}
