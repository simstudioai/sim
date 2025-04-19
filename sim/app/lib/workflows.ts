import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'

export async function getWorkflowById(id: string) {
  const workflows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)

  return workflows[0]
}
