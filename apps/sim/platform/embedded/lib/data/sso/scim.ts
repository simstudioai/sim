'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { isApiClientError } from '@/lib/api/client/errors'
import type { ScimGroupMappingBody } from '@/lib/api/contracts/organization-scim'
import {
  useOrganizationWorkspaces,
  usePermissionGroups,
} from '@/ee/access-control/hooks/permission-groups'
import type { CredentialExpiry, SETTING_TOGGLES } from '@/ee/scim/components/options'
import {
  useConfigureScimConnection,
  useDeleteScimGroupMapping,
  useIssueScimCredential,
  useReconcileScimConnection,
  useRevokeScimCredential,
  useScimActivity,
  useScimConnection,
  useScimGroupMappings,
  useUpsertScimGroupMapping,
} from '@/ee/scim/hooks/scim'
import { plural } from '@/platform/shared/plural'
import { toast } from '@/platform/shared/toast'

type ScimSettingKey = (typeof SETTING_TOGGLES)[number]['key']

/** The organization's SCIM connection, and turning provisioning on or off. */
export function useScimProvisioning(organizationId: string, active: boolean) {
  const { data, isLoading, isError, error, isFetching, refetch } = useScimConnection(
    organizationId,
    active
  )
  const configure = useConfigureScimConnection()
  const connection = data?.connection ?? null
  return {
    failure:
      data === undefined && isError
        ? {
            message: getErrorMessage(error, 'Failed to load directory provisioning settings'),
            retrying: isFetching,
            retry: () => void refetch(),
          }
        : null,
    isLoading,
    connection,
    enabled: connection?.status === 'active',
    updating: configure.isPending,
    setEnabled: async (next: boolean) => {
      try {
        await configure.mutateAsync({ organizationId, status: next ? 'active' : 'disabled' })
        toast.success(next ? 'Directory provisioning enabled' : 'Directory provisioning disabled')
      } catch (failure) {
        toast.error(getErrorMessage(failure, 'Failed to update directory provisioning'))
      }
    },
  }
}

/** An active connection's writes: its rules, its tokens, and reconciling grants against the directory. */
export function useScimConnectionActions(organizationId: string) {
  const configure = useConfigureScimConnection()
  const issueCredential = useIssueScimCredential()
  const revokeCredential = useRevokeScimCredential()
  const reconcile = useReconcileScimConnection()
  return {
    updatingSetting: configure.isPending,
    issuing: issueCredential.isPending,
    reconciling: reconcile.isPending,
    updateSetting: async (key: ScimSettingKey, value: boolean) => {
      try {
        // Only the changed key is sent; the server merges it, so a concurrent edit is not reverted.
        await configure.mutateAsync({ organizationId, settings: { [key]: value } })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to update setting'))
      }
    },
    /** Reports its own failure; `onIssued` receives the one copy of the token there will ever be. */
    issue: async (expiry: CredentialExpiry, onIssued: (secret: string) => void) => {
      if (issueCredential.isPending) return
      try {
        const result = await issueCredential.mutateAsync({
          organizationId,
          ...(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }),
        })
        onIssued(result.secret)
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to issue token'))
      }
    },
    revoke: async (credentialId: string) => {
      await revokeCredential.mutateAsync({ organizationId, credentialId })
      toast.success('Token revoked')
    },
    reconcile: async () => {
      try {
        const report = await reconcile.mutateAsync(organizationId)
        const corrections = report.grantsAdded + report.grantsRemoved
        toast.success(
          corrections === 0
            ? `Checked ${report.reconciledUsers} members. Review Group mappings for assignment status.`
            : `Checked ${report.reconciledUsers} members; corrected ${plural(corrections, 'grant')}`
        )
      } catch (error) {
        toast.error(getErrorMessage(error, 'Reconciliation failed'))
      }
    },
  }
}

/** Recent requests from the identity provider, shaped for a query boundary. */
export function useScimActivityFeed(organizationId: string, active: boolean) {
  const { data, isError, error, isFetching, refetch } = useScimActivity(organizationId, active)
  return { data, error: isError ? error : undefined, isFetching, refetch }
}

/**
 * Permission groups refuse outright where access control is off, which is not a failure to report;
 * anything else may look empty, so it says so.
 */
const refused = (error: unknown) =>
  isApiClientError(error) && [401, 403, 404].includes(error.status)

/**
 * The directory's groups with their mappings, and the permission groups and workspaces a mapping can
 * target. Mappings stay manageable when a target list is missing.
 */
export function useScimGroupMappingList(organizationId: string, active: boolean) {
  const mappings = useScimGroupMappings(organizationId, active)
  const permissionGroups = usePermissionGroups(organizationId, active)
  const workspaces = useOrganizationWorkspaces(organizationId, active)
  const deleteMapping = useDeleteScimGroupMapping()
  if (mappings.isLoading) return { status: 'loading' as const }
  if (mappings.data === undefined && mappings.isError) {
    return {
      status: 'failed' as const,
      message: getErrorMessage(mappings.error, 'Failed to load directory groups'),
      retrying: mappings.isFetching,
      retry: () => void mappings.refetch(),
    }
  }
  if (permissionGroups.isPending || workspaces.isPending) return { status: 'loading' as const }
  const targetsFailed =
    (!permissionGroups.data && !refused(permissionGroups.error)) || !workspaces.data
  return {
    status: 'ready' as const,
    groups: mappings.data,
    // The default group governs by having no members, so it cannot be a membership target.
    permissionGroups: (permissionGroups.data ?? []).filter((group) => !group.isDefault),
    workspaces: workspaces.data ?? [],
    targetsFailure: targetsFailed
      ? {
          retrying: permissionGroups.isFetching || workspaces.isFetching,
          retry: () => {
            void permissionGroups.refetch()
            void workspaces.refetch()
          },
        }
      : null,
    removing: deleteMapping.isPending,
    removeMapping: async (mappingId: string) => {
      await deleteMapping.mutateAsync({ organizationId, mappingId })
      toast.success('Mapping removed')
    },
  }
}

/** Adds one mapping for a directory group, reporting how many members it checked. */
export function useScimMappingAdd(organizationId: string) {
  const upsertMapping = useUpsertScimGroupMapping()
  return {
    adding: upsertMapping.isPending,
    /** Reports its own outcome; `onAdded` runs before the report so the form clears first. */
    add: async (body: ScimGroupMappingBody, onAdded: () => void) => {
      try {
        const result = await upsertMapping.mutateAsync({ organizationId, body })
        onAdded()
        if ((result.mapping.unassignedMemberCount ?? 0) > 0) {
          toast.info('Mapping saved. Some permission-group memberships need attention below.')
        } else {
          toast.success(`Mapping saved. Checked ${plural(result.reconciledUsers, 'member')}.`)
        }
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to add mapping'))
      }
    },
  }
}
