import { isPlainRecord } from '@sim/utils/object'
import type { ConnectorPermissionConfigCapability } from '@/lib/knowledge/connectors/permission-config'
import { writeConnectorPermissions } from '@/lib/knowledge/connectors/permission-store'
import { prepareGitLabPermissionChange } from '@/connectors/gitlab/permission-config/prepare'
import {
  gitLabPermissionData,
  prepareGitLabPermissions,
  readGitLabPermissionSummaries,
  seedGitLabPermissionContext,
} from '@/connectors/gitlab/permission-config/repository'
import { prepareGitLabPermissionScope } from '@/connectors/gitlab/permission-config/scope'
import { setGitLabCsvContext } from '@/connectors/gitlab/permission-config/types'

export const gitLabPermissionConfig: ConnectorPermissionConfigCapability = {
  grantReplacement: {
    supports: (metadata) => isPlainRecord(metadata) && metadata.mode === 'csv',
    async prepare(snapshot, expectedRevision, grants, source) {
      const { stored, scope } = await prepareGitLabPermissionScope(
        snapshot,
        expectedRevision,
        source
      )
      const prepared = prepareGitLabPermissions(
        { ...grants, mode: 'csv', expectedRevision },
        scope,
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
        if ('group' in prepared.snapshot) {
          const { host, group, projects } = prepared.snapshot
          context.gitLabGroupScope = { host, group, projects }
          context.gitLabPermissionMode = prepared.snapshot.mode
        }
        if (prepared.snapshot.mode === 'csv' && !('group' in prepared.snapshot))
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
  populateSyncContext: seedGitLabPermissionContext,
}
