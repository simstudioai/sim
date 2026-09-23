'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { ApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/auth-client'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOptionalOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  useOrganizationSecretSource,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'

interface OrganizationSecretInputContextValue {
  isSaving: boolean
  save(variables: Record<string, string>): Promise<void>
}

const OrganizationSecretInputContext = createContext<OrganizationSecretInputContextValue | null>(
  null
)

export function useOrganizationSecretInput() {
  return useContext(OrganizationSecretInputContext)
}

/** Only source metadata is loaded; existing secret values never enter the chat UI. */
export function OrganizationSecretInputHost({
  organizationId,
  children,
}: {
  organizationId: string
  children: ReactNode
}) {
  const organizationContext = useOptionalOrganizationContext()
  const { data: session } = useSession()
  const matchesOrganization = organizationContext?.organization.id === organizationId
  const sourceQuery = useOrganizationSecretSource(matchesOrganization ? organizationId : '')
  const mutation = useSaveOrganizationSecrets(organizationId)

  if (!organizationContext || !matchesOrganization || !session?.user?.id)
    return (
      <p role='status'>Open this request in an organization conversation to add Generic Secrets.</p>
    )
  if (sourceQuery.isPending) return <p role='status'>Loading Generic Secrets…</p>
  if (sourceQuery.isError)
    return (
      <p role='status'>
        Could not load Generic Secrets.{' '}
        <button type='button' className='underline' onClick={() => void sourceQuery.refetch()}>
          Retry
        </button>
      </p>
    )

  const source = sourceQuery.data?.source
  if (!source)
    return (
      <p role='status'>
        {organizationContext.viewer.isAdmin ? (
          <>
            Enable Generic Secrets in{' '}
            <a
              className='underline'
              href={organizationRoutes(organizationId).settingsSection('integrations')}
            >
              organization Integrations settings
            </a>
            , then return here to enter the keys.
          </>
        ) : (
          'Ask an organization admin to enable Generic Secrets in Integrations.'
        )}
      </p>
    )
  if (source.mode === 'organization' && !organizationContext.viewer.isAdmin)
    return <p role='status'>Ask an organization admin to add these shared Generic Secrets.</p>

  const save = async (variables: Record<string, string>) => {
    try {
      await mutation.mutateAsync({
        sourceId: source.id,
        mode: source.mode,
        upsert: variables,
        remove: [],
      })
    } catch (error) {
      // The server compares this source under lock. Refreshing a changed source
      // remounts the form below, discarding drafts instead of redirecting them.
      if (error instanceof ApiClientError && (error.status === 409 || error.status === 404))
        await sourceQuery.refetch()
      throw error
    } finally {
      mutation.reset()
    }
  }

  return (
    <OrganizationSecretInputContext.Provider
      key={`${organizationId}:${session.user.id}:${source.id}:${source.mode}`}
      value={{ save, isSaving: mutation.isPending }}
    >
      {children}
    </OrganizationSecretInputContext.Provider>
  )
}
