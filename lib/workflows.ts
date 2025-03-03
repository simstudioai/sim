import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { LogEntry, persistLog } from '@/lib/logging'
import { WebhookConfig, WebhookData } from '@/lib/types'
import { db } from '@/db'
import { workflow as workflowTable, workflow_logs } from '@/db/schema'

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

/**
 * Configure webhook settings for a workflow
 * @param id The workflow ID
 * @param isEnabled Whether the webhook is enabled
 * @param secretToken Optional secret token (will be generated if not provided)
 * @returns Success status and the webhook config
 */
export async function configureWebhook(id: string, isEnabled: boolean, secretToken?: string) {
  // Get the current workflow
  const workflow = await getWorkflowById(id)

  if (!workflow) {
    throw new Error('Workflow not found')
  }

  const now = new Date().toISOString()
  const currentWebhookConfig = (workflow.webhookConfig as WebhookConfig) || {}

  // Update the workflow with webhook configuration
  await db
    .update(workflowTable)
    .set({
      executionMethod: isEnabled
        ? 'webhook'
        : workflow.executionMethod === 'webhook'
          ? 'manual'
          : workflow.executionMethod,
      webhookConfig: isEnabled
        ? {
            secretToken: secretToken || crypto.randomBytes(32).toString('hex'),
            isActive: true,
            createdAt: currentWebhookConfig.createdAt || now,
            updatedAt: now,
          }
        : {
            ...currentWebhookConfig,
            isActive: false,
            updatedAt: now,
          },
    })
    .where(eq(workflowTable.id, id))

  // Get the updated workflow
  const updatedWorkflow = await getWorkflowById(id)

  return {
    success: true,
    webhook: updatedWorkflow?.webhookConfig,
  }
}

/**
 * Get the webhook configuration for a workflow
 * @param id The workflow ID
 * @returns The webhook configuration or null if not configured
 */
export async function getWebhookConfig(id: string) {
  const workflow = await getWorkflowById(id)
  return (workflow?.webhookConfig as WebhookConfig) || null
}

/**
 * Validate a webhook signature
 * @param signature The signature from the request header
 * @param secretToken The stored secret token for the webhook
 * @param payload The raw request body
 * @returns Whether the signature is valid
 */
export function validateWebhookSignature(
  signature: string | null,
  secretToken: string,
  payload: string
): boolean {
  if (!signature) return false

  const hmac = crypto.createHmac('sha256', secretToken)
  const computedSignature = hmac.update(payload).digest('hex')

  return computedSignature === signature
}

/**
 * Log webhook execution details
 */
export async function logWebhookExecution(
  workflowId: string,
  executionId: string,
  webhookData: WebhookData,
  message: string = 'Webhook execution'
) {
  await persistLog({
    id: crypto.randomUUID(),
    workflowId,
    executionId,
    level: 'info',
    message,
    trigger: 'webhook',
    webhookData,
    createdAt: new Date(),
  } as LogEntry)
}
