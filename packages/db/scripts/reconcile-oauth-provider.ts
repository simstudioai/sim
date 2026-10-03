import { reconcileOAuthProviderLifecycle } from '@sim/db/oauth-provider-lifecycle'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'

const logger = createLogger('OAuthProviderLifecycleReconciliation')
const url = process.env.DATABASE_URL
if (!url) throw new Error('Missing DATABASE_URL')

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  connection: { application_name: 'sim-oauth-provider-reconcile' },
})

try {
  await reconcileOAuthProviderLifecycle(sql)
  logger.info('OAuth provider lifecycle reconciliation completed')
} finally {
  await sql.end()
}
