'use client'

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import {
  useOrganizationSecrets,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'
import { useOrganization } from '@/platform/lib/data/organization'

const logger = createLogger('SecretsManager')

/**
 * One source's Generic Secrets, read only by whom may hold them: the organization's for an admin, a
 * member's own for that member. `editor` stays once loaded, so a failed refresh keeps drafts on
 * screen, and `failure` says whether it was the first load or a refresh that failed.
 */
export function useGenericSecrets(organizationId: string, mode: SecretSourceMode) {
  const { viewer } = useOrganization()
  const secrets = useOrganizationSecrets(organizationId, mode, mode === 'member' || viewer.isAdmin)
  const save = useSaveOrganizationSecrets(organizationId)
  const data = secrets.data
  return {
    failure: secrets.error
      ? {
          message: getErrorMessage(
            secrets.error,
            data ? 'Could not refresh secrets' : 'Could not load secrets'
          ),
          retrying: secrets.isFetching,
          retry: () => void secrets.refetch(),
        }
      : null,
    editor: data
      ? {
          sourceId: data.source.id,
          variables: data.variables,
          isSaving: save.isPending,
          save: (changes: { upsert: Record<string, string>; remove: string[] }) =>
            save.mutateAsync({ ...changes, sourceId: data.source.id, mode }).catch((error) => {
              logger.error('Failed to save secrets', {
                error: getErrorMessage(error, 'Unknown error'),
              })
              throw error
            }),
        }
      : null,
  }
}
