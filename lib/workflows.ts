import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'

export async function getWorkflowById(id: string) {
  const workflows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)

  return workflows[0]
}

export async function updateWorkflowDeploymentStatus(
  id: string,
  isDeployed: boolean,
  apiKey?: string
) {
  return db
    .update(workflowTable)
    .set({
      isDeployed,
      deployedAt: isDeployed ? new Date() : null,
      updatedAt: new Date(),
      apiKey: apiKey || null,
    })
    .where(eq(workflowTable.id, id))
}

export function getWorkflowEndpoint(id: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${baseUrl}/api/workflow/${id}`
}
