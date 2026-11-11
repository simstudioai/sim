'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { UpdateCredentialGroupBody } from '@/lib/api/contracts/credential-groups'
import { isOrganizationCredentialType } from '@/lib/credential-groups/credential-types'
import {
  isManagedMcpConnectorId,
  MANAGED_MCP_CONNECTORS,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  getCredentialGroupProviderService,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { toast } from '@/lib/toast/sink'
import {
  useAddOrganizationAccountMcpProvider,
  useConfigureOrganizationMcp,
  useInviteOrganizationAccountPeople,
  useOrganizationDatabricksSetup,
  useRemoveOrganizationAccountMcpProvider,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/hooks/queries/organization-account-management'
import {
  useEnsureOrganizationAccounts,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

interface CredentialProviderChoice {
  key: string
  provider: string
  method: 'oauth' | 'mcp'
}

export interface WorkspaceGrant {
  workspaceId: string
  types: 'all' | string[]
}

export interface DatabricksDraft {
  name: string
  url: string
  clientId: string
  /** Blank keeps the stored secret. */
  clientSecret: string
}

/** Addresses a send could not reach, kept in the form with the notice explaining them. */
interface InviteFailure {
  failed: string[]
  notice: string
}

/**
 * The Credential Groups edits, filled by the session's example on fixtures and by the organization
 * account mutations on live data. Each settles with its change, so a dialog holds on it.
 */
export interface CredentialGroupActions {
  setUp: () => Promise<void>
  addProvider: (provider: CredentialProviderChoice) => Promise<void>
  removeProvider: (provider: CredentialProviderChoice) => Promise<void>
  updateConfigurations: () => Promise<void>
  saveDatabricks: (draft: DatabricksDraft) => Promise<void>
  /** Resolves to the failures when only some addresses were sent. */
  invite: (emails: string[]) => Promise<InviteFailure | null>
  resend: (personId: string) => Promise<void>
  revoke: (personId: string) => Promise<void>
  saveGrants: (grants: WorkspaceGrant[]) => Promise<void>
}

type ProviderOptions = NonNullable<UpdateCredentialGroupBody['options']>

/** What the live edits need beyond the view: the group, its saved options and access revision. */
export interface CredentialGroupManagement {
  groupId: string | null
  options: ProviderOptions
  accessRevision: number
  databricksConfigured: boolean
}

export function useDatabricksConfiguration(organizationId: string, configured: boolean) {
  const setup = useOrganizationDatabricksSetup(organizationId, configured)
  const server = setup.data?.server
  return server
    ? {
        name: server.name,
        url: server.url ?? '',
        clientId: server.oauthClientId ?? '',
        hasSecret: server.hasOauthClientSecret,
      }
    : undefined
}

/**
 * Credential Groups on live data, over the same organization account mutations the legacy section
 * used. The section reads on the server, so each successful edit refreshes the route.
 */
export function useLiveCredentialGroupActions(
  organizationId: string,
  management: CredentialGroupManagement
): CredentialGroupActions {
  const router = useRouter()
  const ensure = useEnsureOrganizationAccounts()
  const update = useUpdateOrganizationAccounts()
  const addMcp = useAddOrganizationAccountMcpProvider()
  const removeMcp = useRemoveOrganizationAccountMcpProvider()
  const configureMcp = useConfigureOrganizationMcp()
  const invite = useInviteOrganizationAccountPeople()
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()
  const updateAccess = useUpdateOrganizationAccountWorkspaceAccess()
  const { groupId, options } = management

  async function updateOptions(next: ProviderOptions) {
    if (!groupId) throw new Error('Set up credential groups first')
    await update.mutateAsync({ organizationId, groupId, update: { options: next } })
  }

  return {
    setUp: async () => {
      try {
        await ensure.mutateAsync({ organizationId })
        router.refresh()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not set up credential groups'))
      }
    },
    addProvider: async ({ method, provider }) => {
      if (method === 'mcp') {
        if (!isManagedMcpConnectorId(provider) || provider === 'databricks')
          throw new Error('This provider is added through its own setup')
        await addMcp.mutateAsync({ organizationId, connectorId: provider })
        toast.success(`${MANAGED_MCP_CONNECTORS[provider].name} added`)
      } else {
        if (!isCredentialGroupProvider(provider) || provider === 'slack')
          throw new Error('This provider is added through its own setup')
        const service = getCredentialGroupProviderService(provider)
        await updateOptions([...options, { provider, label: service.name, required: false }])
        toast.success(`${service.name} added`)
      }
      router.refresh()
    },
    removeProvider: async ({ method, provider }) => {
      if (method === 'mcp') {
        if (!isManagedMcpConnectorId(provider)) throw new Error('Unknown provider')
        await removeMcp.mutateAsync({ organizationId, connectorId: provider })
      } else {
        await updateOptions(options.filter((option) => option.provider !== provider))
      }
      toast.success('Provider removed')
      router.refresh()
    },
    updateConfigurations: async () => {
      try {
        await updateOptions(options)
        toast.success('Provider configurations updated')
        router.refresh()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not update provider configurations'))
      }
    },
    saveDatabricks: async ({ name, url, clientId, clientSecret }) => {
      const fields = {
        organizationId,
        name,
        url,
        oauthClientId: clientId,
        ...(clientSecret.trim() ? { oauthClientSecret: clientSecret.trim() } : {}),
      }
      if (management.databricksConfigured) await configureMcp.mutateAsync(fields)
      else await addMcp.mutateAsync({ ...fields, connectorId: 'databricks' })
      toast.success(
        management.databricksConfigured ? 'Databricks configuration saved' : 'Databricks added'
      )
      router.refresh()
    },
    invite: async (emails) => {
      const result = await invite.mutateAsync({ organizationId, emails })
      router.refresh()
      const failures = result.results.filter((item) => !item.success)
      if (failures.length === 0) {
        toast.success(
          result.sentCount === 1
            ? 'Connection request sent'
            : `${result.sentCount} connection requests sent`
        )
        return null
      }
      return {
        failed: failures.map((item) => item.email),
        notice:
          result.sentCount > 0
            ? `${result.sentCount} sent. ${failures.length} failed: ${failures.map((item) => item.email).join(', ')}`
            : `No invitations were sent: ${failures.map((item) => `${item.email} (${item.error})`).join(', ')}`,
      }
    },
    resend: async (enrollmentId) => {
      try {
        await resend.mutateAsync({ organizationId, enrollmentId })
        toast.success('Invitation sent')
        router.refresh()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not resend the invitation'))
      }
    },
    revoke: async (enrollmentId) => {
      await revoke.mutateAsync({ organizationId, enrollmentId })
      toast.success('Access revoked')
      router.refresh()
    },
    saveGrants: async (grants) => {
      try {
        await updateAccess.mutateAsync({
          organizationId,
          revision: management.accessRevision,
          grants: grants.map((grant) => ({
            workspaceId: grant.workspaceId,
            access:
              grant.types === 'all'
                ? { mode: 'all' as const }
                : {
                    mode: 'selected' as const,
                    credentialTypes: grant.types.map((type) => {
                      if (!isOrganizationCredentialType(type))
                        throw new Error(`Unknown credential type ${type}`)
                      return type
                    }),
                  },
          })),
        })
        toast.success('Workspace access updated')
        router.refresh()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not update workspace access'))
        throw error
      }
    },
  }
}
