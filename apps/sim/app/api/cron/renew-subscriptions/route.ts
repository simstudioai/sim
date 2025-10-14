import { db } from '@sim/db'
import { webhook as webhookTable, workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getAllSubscriptionManagers } from '@/lib/webhooks/subscriptions'

const logger = createLogger('SubscriptionRenewal')

/**
 * Cron endpoint to renew provider subscriptions before they expire
 *
 * Configured in helm/sim/values.yaml under cronjobs.jobs.renewSubscriptions
 *
 */
export async function GET(request: Request) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('Unauthorized cron request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info('Starting subscription renewal job')

    const managers = getAllSubscriptionManagers()
    let totalRenewed = 0
    let totalFailed = 0
    let totalChecked = 0

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

    return NextResponse.json({
      success: true,
      checked: totalChecked,
      renewed: totalRenewed,
      failed: totalFailed,
      total: webhooksWithWorkflows.length,
    })
  } catch (error) {
    logger.error('Error in subscription renewal job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
