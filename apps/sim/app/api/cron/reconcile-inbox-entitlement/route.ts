import { db, workspace } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { hasWorkspaceInboxGraceAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { disableInbox } from '@/lib/mothership/inbox/lifecycle'

const logger = createLogger('InboxEntitlementReconcileCron')

export const dynamic = 'force-dynamic'

/**
 * Periodic inbox (Sim Mailer) entitlement reconciliation. Releases the AgentMail
 * inbox + webhook for any workspace whose provisioned inbox has outlived its
 * plan — i.e. `inboxEnabled` is still true but the billing entity no longer
 * holds an entitled (active or `past_due`) Max/Enterprise subscription.
 *
 * Teardown keys off {@link hasWorkspaceInboxGraceAccess}, which tolerates
 * `past_due`, so a transient payment failure never destroys a paying customer's
 * inbox — only a genuinely terminal plan (canceled/downgraded) is reclaimed.
 * `disableInbox` swallows AgentMail delete failures, so a rerun or a race with a
 * manual disable is a no-op. On self-hosted / billing-disabled deployments the
 * grace check returns true for every workspace, making this sweep inert.
 *
 * Scheduled in helm/sim/values.yaml under cronjobs.jobs.reconcileInboxEntitlement.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Inbox entitlement reconciliation')
  if (authError) {
    return authError
  }

  const enabledWorkspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.inboxEnabled, true))

  let disabled = 0
  for (const ws of enabledWorkspaces) {
    try {
      if (await hasWorkspaceInboxGraceAccess(ws.id)) {
        continue
      }
      await disableInbox(ws.id)
      disabled++
      logger.info('Reclaimed inbox for workspace with terminated Sim Mailer entitlement', {
        workspaceId: ws.id,
      })
    } catch (error) {
      logger.error('Failed to reconcile inbox entitlement for workspace', {
        workspaceId: ws.id,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  }

  logger.info('Inbox entitlement reconciliation complete', {
    checked: enabledWorkspaces.length,
    disabled,
  })

  return NextResponse.json({ checked: enabledWorkspaces.length, disabled })
})
