import { db } from '@sim/db'
import { slackApp, slackSearchInstallation } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSharedSlackSearchAppConfiguration } from '@/lib/slack-search/shared-app-configuration'

/** Called only inside authorized installation/member operations; never returns secrets to a surface. */
export async function readSharedSlackSearchApp() {
  if (!(await isFeatureEnabled('slack-search-shared-app'))) return null
  return getSharedSlackSearchAppConfiguration()
}

/** Existing custom bots remain independent of the shared-app rollout. */
export async function requireSlackSearchAppAvailable(appId: string) {
  const shared = getSharedSlackSearchAppConfiguration(appId)
  if (shared?.id === appId) {
    if (!(await readSharedSlackSearchApp()))
      throw new OrchestrationError('forbidden', 'The shared Slack Search app is unavailable')
    return
  }
  const [app] = await db
    .select({ kind: slackApp.kind })
    .from(slackApp)
    .where(eq(slackApp.id, appId))
    .limit(1)
  if (app?.kind !== 'shared') return
  const configured = await readSharedSlackSearchApp()
  if (configured?.id !== appId)
    throw new OrchestrationError('forbidden', 'The shared Slack Search app is unavailable')
}

/** Canonical lookup inside an authorized organization operation. */
export async function findSharedSlackSearchInstallation(organizationId: string) {
  const app = await readSharedSlackSearchApp()
  if (!app) return null
  const installations = await db
    .select()
    .from(slackSearchInstallation)
    .where(
      and(
        eq(slackSearchInstallation.organizationId, organizationId),
        eq(slackSearchInstallation.slackAppId, app.id),
        eq(slackSearchInstallation.enabled, true)
      )
    )
    .limit(2)
  if (installations.length > 1)
    throw new OrchestrationError('conflict', 'Select a single Slack workspace for Search')
  return installations[0] ? { ...installations[0], appRevision: app.revision } : null
}
