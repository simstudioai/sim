import { getErrorMessage } from '@sim/utils/errors'
import { decryptApiKey, encryptApiKey } from '@/lib/api-key/crypto'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GitLabCsvValidationError } from '@/connectors/gitlab/permission-config/parser'
import {
  loadGitLabPermissionSnapshot,
  type PreparedGitLabPermissions,
  prepareGitLabPermissions,
} from '@/connectors/gitlab/permission-config/repository'
import type { GitLabPermissionInput } from '@/connectors/gitlab/permission-config/types'
import { validateGitLabCsvToken } from '@/connectors/gitlab/permissions'

/** Prepares private writes after the application has authorized the canonical connector owner. */
export async function prepareGitLabPermissionChange(input: {
  connectorType: string
  accessMode: string
  sourceConfig: Record<string, unknown>
  permissions?: GitLabPermissionInput
  apiKey?: string
  existing?: {
    id: string
    encryptedApiKey: string | null
    sourceConfig: unknown
  }
}): Promise<{ permissions?: PreparedGitLabPermissions; encryptedApiKey?: string }> {
  if (input.connectorType !== 'gitlab') {
    if (input.permissions || (input.existing && input.apiKey !== undefined)) {
      throw new OrchestrationError(
        'validation',
        'GitLab token and CSV settings require a GitLab source with permission-aware access.'
      )
    }
    return {}
  }
  if (input.accessMode !== 'admin' && (input.permissions || input.apiKey !== undefined)) {
    throw new OrchestrationError(
      'validation',
      'Token and CSV settings require permission-aware access.'
    )
  }
  const existing = input.existing ? await loadGitLabPermissionSnapshot(input.existing.id) : null
  if (input.accessMode !== 'admin' && !existing) return {}
  if (!input.permissions && !existing && !input.apiKey) return {}
  if (
    input.existing &&
    (input.permissions || input.apiKey) &&
    input.permissions?.expectedRevision === undefined
  ) {
    throw new OrchestrationError(
      'conflict',
      'Reload GitLab settings before saving the token or permissions.'
    )
  }
  const permissions = input.permissions ?? {
    mode: existing?.mode ?? 'administrator',
    expectedRevision: existing?.revision ?? 0,
  }
  const previousConfig = input.existing?.sourceConfig as Record<string, unknown> | undefined
  const sameProject =
    existing &&
    previousConfig &&
    previousConfig.host === input.sourceConfig.host &&
    previousConfig.project === input.sourceConfig.project
  const project =
    sameProject && !input.apiKey && existing.mode === permissions.mode
      ? { host: existing.host, projectId: existing.projectId, projectPath: existing.projectPath }
      : await validateGitLabCsvToken(
          input.apiKey ??
            (input.existing?.encryptedApiKey
              ? (await decryptApiKey(input.existing.encryptedApiKey)).decrypted
              : ''),
          input.sourceConfig
        ).catch((error: unknown) => {
          throw new OrchestrationError(
            'validation',
            getErrorMessage(error, 'Unable to validate the GitLab token and project.')
          )
        })
  try {
    return {
      permissions: prepareGitLabPermissions(
        permissions,
        project,
        existing,
        Boolean(input.existing)
      ),
      ...(input.existing && input.apiKey
        ? { encryptedApiKey: (await encryptApiKey(input.apiKey)).encrypted }
        : {}),
    }
  } catch (error) {
    if (error instanceof GitLabCsvValidationError)
      throw new OrchestrationError('validation', error.message)
    throw error
  }
}
