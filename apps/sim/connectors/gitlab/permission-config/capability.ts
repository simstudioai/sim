import type { ConnectorPermissionConfigCapability } from '@/lib/knowledge/connectors/permission-config'
import { writeConnectorPermissions } from '@/lib/knowledge/connectors/permission-store'
import { prepareGitLabPermissionChange } from '@/connectors/gitlab/permission-config/prepare'
import {
  gitLabPermissionData,
  prepareGitLabPermissions,
  readGitLabPermissionMetadata,
  readGitLabPermissionSummaries,
  seedGitLabCsvContext,
} from '@/connectors/gitlab/permission-config/repository'
import { setGitLabCsvContext } from '@/connectors/gitlab/permission-config/types'

export const gitLabPermissionConfig: ConnectorPermissionConfigCapability = {
  grantReplacement: {
    supports: (metadata) => readGitLabPermissionMetadata(metadata).mode === 'csv',
    prepare(snapshot, expectedRevision, grants) {
      const stored = {
        ...readGitLabPermissionMetadata(snapshot.metadata),
        revision: snapshot.revision,
      }
      const prepared = prepareGitLabPermissions(
        { ...grants, mode: 'csv', expectedRevision },
        stored,
        stored,
        true
      )
      return gitLabPermissionData(prepared)
    },
  },
  async prepare(input) {
    const change = await prepareGitLabPermissionChange({
      ...input,
      connectorType: 'gitlab',
      permissions: input.permissionConfig,
    })
    const prepared = change.permissions
    if (!prepared) return undefined
    return {
      requiresAclReset: prepared.rewriteAccess,
      requiresContentSync: prepared.rewriteAccess || Boolean(change.encryptedApiKey),
      encryptedApiKey: change.encryptedApiKey,
      populateSyncContext(context, connectorId) {
        if (prepared.snapshot.mode === 'csv')
          setGitLabCsvContext(context, { connectorId, ...prepared.snapshot })
      },
      async write(tx, connectorId) {
        await writeConnectorPermissions(tx, connectorId, {
          expectedRevision: prepared.expectedRevision,
          ...gitLabPermissionData(prepared),
        })
      },
    }
  },
  async readSummaries(connectorIds) {
    const summaries = await readGitLabPermissionSummaries(connectorIds)
    return new Map(
      connectorIds.map((id) => [
        id,
        {
          provider: 'gitlab' as const,
          ...(summaries.get(id) ?? {
            mode: 'administrator' as const,
            revision: 0,
            userMapping: null,
            projectPermissions: null,
          }),
        },
      ])
    )
  },
  populateSyncContext: seedGitLabCsvContext,
}
