import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import {
  createPostgresCredentialGroupPolicyLifecycleStore,
  reconcileCredentialGroupResourcePolicies,
} from '../credential-group-resource-policies'

const logger = createLogger('CredentialGroupResourcePolicyReconciliation')
const url = process.env.DATABASE_URL

if (!url) {
  throw new Error('Missing DATABASE_URL')
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-credential-group-policy-reconcile' },
})

try {
  const result = await reconcileCredentialGroupResourcePolicies(
    createPostgresCredentialGroupPolicyLifecycleStore(sql)
  )
  logger.info('Credential Group policy reconciliation completed', result)
} finally {
  await sql.end()
}
