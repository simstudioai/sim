'use client'

import { getErrorMessage } from '@sim/utils/errors'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganization } from '@/lib/organizations/provider'
import {
  useOrganizationSecrets,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'

/**
 * One source's Generic Secrets, read only by whom may hold them: the organization's for an admin, a
 * member's own for that member. `editor` stays once loaded, so a failed refresh keeps drafts on
 * screen, and `failure` says whether it was the first load or a refresh that failed.
 */
export function useGenericSecrets(mode: SecretSourceMode) {
  const { organization, viewer } = useOrganization()
  const secrets = useOrganizationSecrets(organization.id, mode, mode === 'member' || viewer.isAdmin)
  const save = useSaveOrganizationSecrets(organization.id)
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
            save.mutateAsync({ ...changes, sourceId: data.source.id, mode }),
        }
      : null,
  }
}
