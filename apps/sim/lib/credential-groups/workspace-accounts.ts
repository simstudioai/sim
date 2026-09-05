import { type CredentialGroupOptionConfig, credentialGroup } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import {
  credentialGroupWorkflowAccessPolicyCodec,
  requireDefaultCredentialGroupWorkflowAccessPolicy,
} from '@/lib/credential-groups/application/workflow-access-policy'
import type { DbOrTx } from '@/lib/db/types'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

/** Creates the workspace's account container and its initial policy in the caller's transaction. */
export async function createWorkspaceAccountsGroup(
  executor: DbOrTx,
  workspaceId: string,
  userId: string,
  options: CredentialGroupOptionConfig[] = []
): Promise<typeof credentialGroup.$inferSelect> {
  const [created] = await executor
    .insert(credentialGroup)
    .values({
      id: generateId(),
      workspaceId,
      publicId: generateId(),
      name: 'Connected accounts',
      description: 'Accounts connected for workspace searches and workflows.',
      options,
      createdBy: userId,
    })
    .returning()
  if (!created) throw new Error('Connected accounts insert returned no row')
  const policy = await requireResourcePolicy(
    {
      workspaceId,
      resourceType: 'credential_group',
      resourceId: created.id,
      codec: credentialGroupWorkflowAccessPolicyCodec,
    },
    executor
  )
  requireDefaultCredentialGroupWorkflowAccessPolicy({
    revision: policy.revision,
    document: policy.document,
    credentialGroupId: created.id,
  })
  return created
}
