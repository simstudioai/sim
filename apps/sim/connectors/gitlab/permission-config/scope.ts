import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { gitLabGroupMatchesConfig, gitLabProjectIdentitiesMatch } from '@/connectors/gitlab/group'
import { readGitLabPermissionMetadata } from '@/connectors/gitlab/permission-config/repository'
import { discoverGitLabGroup } from '@/connectors/gitlab/permissions'

/** Revalidates the configured identity and group catalog without loading private CSV rows. */
export async function prepareGitLabPermissionScope(
  snapshot: { metadata: unknown; revision: number },
  expectedRevision: number,
  source: { encryptedApiKey: string | null; sourceConfig: unknown }
) {
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
    if (!gitLabProjectIdentitiesMatch(stored.projects, discovered.projects))
      throw new OrchestrationError(
        'validation',
        'A GitLab project identity changed. Create a new connection before granting access to a replacement project.'
      )
    scope = { ...stored, ...discovered }
  }
  return { stored, scope }
}
