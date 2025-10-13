import { db } from '@sim/db'
import { webhook as webhookTable, workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk/v3'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getAllSubscriptionManagers } from '@/lib/webhooks/subscriptions'

const logger = createLogger('SubscriptionRenewal')

/**
 * Background job to renew expiring provider subscriptions
 *
 * This job runs periodically (e.g., every 2 days) to find and renew subscriptions
 * that are approaching expiration. It works with all registered subscription managers
 * (Teams, Telegram, future providers...) via a unified interface.
 */
export const renewSubscriptions = task({
  id: 'renew-subscriptions',
  run: async (_payload: Record<string, never>) => {
    logger.info('Starting subscription renewal job')

    const managers = getAllSubscriptionManagers()
    let totalRenewed = 0
    let totalFailed = 0
    let totalChecked = 0

    try {
      // Get all active webhooks with their workflows
      const webhooksWithWorkflows = await db
        .select({
          webhook: webhookTable,
          workflow: workflowTable,
        })
        .from(webhookTable)
        .innerJoin(workflowTable, eq(webhookTable.workflowId, workflowTable.id))
        .where(eq(webhookTable.isActive, true))

      logger.info(
        `Found ${webhooksWithWorkflows.length} active webhooks, checking for expiring subscriptions`
      )

      for (const { webhook, workflow } of webhooksWithWorkflows) {
        // Normalize webhook data for manager
        const webhookForManager = {
          ...webhook,
          providerConfig: (webhook.providerConfig as Record<string, unknown>) || {},
        }

        // Find a manager that can handle this webhook
        const manager = managers.find((m) => m.canHandle(webhookForManager))
        if (!manager) continue

        // Check if this subscription needs renewal
        if (!manager.needsRenewal(webhookForManager)) continue

        totalChecked++

        try {
          logger.info(
            `Renewing ${manager.id} subscription for webhook ${webhook.id} (workflow ${workflow.id})`
          )

          const result = await manager.renew(webhookForManager, workflow, `renewal-${webhook.id}`)

          if (result.success) {
            logger.info(
              `Successfully renewed ${manager.id} subscription for webhook ${webhook.id}${result.expiresAt ? `. New expiration: ${result.expiresAt.toISOString()}` : ''}`
            )
            totalRenewed++
          } else {
            logger.error(
              `Failed to renew ${manager.id} subscription for webhook ${webhook.id}: ${result.error}`
            )
            totalFailed++
          }
        } catch (error) {
          logger.error(`Error renewing subscription for webhook ${webhook.id}:`, error)
          totalFailed++
        }
      }

      logger.info(
        `Subscription renewal job completed. Checked: ${totalChecked}, Renewed: ${totalRenewed}, Failed: ${totalFailed}`
      )

      return {
        success: true,
        checked: totalChecked,
        renewed: totalRenewed,
        failed: totalFailed,
        total: webhooksWithWorkflows.length,
      }
    } catch (error) {
      logger.error('Error in subscription renewal job:', error)
      throw error
    }
  },
})
