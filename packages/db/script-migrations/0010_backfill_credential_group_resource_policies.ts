import { createLogger } from '@sim/logger'
import {
  createPostgresCredentialGroupPolicyLifecycleStore,
  reconcileCredentialGroupResourcePolicies,
} from '../credential-group-resource-policies'
import type { ScriptMigration } from './types'

const logger = createLogger('CredentialGroupResourcePolicyMigration')

export const backfillCredentialGroupResourcePolicies: ScriptMigration = {
  name: '0010_backfill_credential_group_resource_policies',
  async up(sql) {
    const result = await reconcileCredentialGroupResourcePolicies(
      createPostgresCredentialGroupPolicyLifecycleStore(sql)
    )
    logger.info('Credential Group policy reconciliation completed', result)
  },
}
