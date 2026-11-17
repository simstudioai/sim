import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ConnectorPermissionConfigCapability } from '@/lib/knowledge/connectors/permission-config'
import { writeConnectorPermissions } from '@/lib/knowledge/connectors/permission-store'
import { gitLabGroupMatchesConfig } from '@/connectors/gitlab/group'
import { prepareGitLabPermissionChange } from '@/connectors/gitlab/permission-config/prepare'
import {
  gitLabPermissionData,
  prepareGitLabPermissions,
  readGitLabPermissionMetadata,
  readGitLabPermissionSummaries,
  seedGitLabPermissionContext,
} from '@/connectors/gitlab/permission-config/repository'
import { setGitLabCsvContext } from '@/connectors/gitlab/permission-config/types'
import { discoverGitLabGroup } from '@/connectors/gitlab/permissions'

export const gitLabPermissionConfig: ConnectorPermissionConfigCapability = {
  grantReplacement: {
    supports: (metadata) => readGitLabPermissionMetadata(metadata).mode === 'csv',
    async prepare(snapshot, expectedRevision, grants, source) {
      const stored = {
        ...readGitLabPermissionMetadata(snapshot.metadata),
        revision: snapshot.revision,
      }
      if (stored.revision !== expectedRevision)
        throw new OrchestrationError(
          'conflict',
          'GitLab permissions changed. Reload the connection before saving.'
        )
      let scope = stored
      if ('group' in stored) {
        if (
          !source.encryptedApiKey ||
          !isPlainRecord(source.sourceConfig) ||
          source.sourceConfig.scope !== 'group'
        )
          throw new OrchestrationError('validation', 'An admin must update this GitLab connection.')
        const { decrypted } = await decryptApiKey(source.encryptedApiKey)
        const discovered = await discoverGitLabGroup(decrypted, source.sourceConfig, 'csv').catch(
          (error: unknown) => {
            if (error instanceof OutboundRoutingError) throw error
            throw new OrchestrationError(
              'validation',
              getErrorMessage(error, 'Unable to validate the GitLab group.')
            )
          }
        )
        if (
          discovered.host !== stored.host ||
          discovered.group.id !== stored.group.id ||
          !gitLabGroupMatchesConfig(discovered, source.sourceConfig)
        )
          throw new OrchestrationError(
            'validation',
            'The GitLab group identity changed. Update the connection before replacing permissions.'
          )
        scope = { ...stored, ...discovered }
      }
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
