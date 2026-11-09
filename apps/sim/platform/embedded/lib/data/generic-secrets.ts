'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganization } from '@/lib/organizations/provider'
import { toast } from '@/lib/toast/sink'
import {
  useConfigureOrganizationSecretSource,
  useOrganizationSecrets,
  useRemoveOrganizationSecretSource,
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

/** Adds or reconfigures the Generic Secrets source; an organization source then opens its secrets. */
export function useGenericSecretSourceSetup(organizationId: string) {
  const configure = useConfigureOrganizationSecretSource(organizationId)
  const router = useRouter()
  return {
    pending: configure.isPending,
    save: async (sourceId: string | null, mode: SecretSourceMode) => {
      await configure.mutateAsync({ sourceId, mode })
      if (mode === 'organization')
        router.push(organizationRoutes(organizationId).organizationSecrets)
    },
  }
}

/** Removes the Generic Secrets source; a failure toasts and resolves `false` to keep the dialog open. */
export function useGenericSecretSourceRemoval(organizationId: string) {
  const remove = useRemoveOrganizationSecretSource(organizationId)
  return async (sourceId: string) => {
    try {
      await remove.mutateAsync(sourceId)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove the source'))
      return false
    }
  }
}
