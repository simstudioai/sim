'use client'

import { type ComponentType, useCallback, useMemo, useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipCopyInput,
  ChipInput,
  ChipLink,
  ChipTextarea,
  Send,
  toast,
} from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { writeOAuthReturnContext } from '@/lib/credentials/client-state'
import { INTEGRATIONS, resolveOAuthServiceForIntegration } from '@/lib/integrations'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import {
  AddPeopleModal,
  CredentialDetailHeading,
  CredentialDetailLayout,
  CredentialMembersSection,
  DetailSection,
  UnsavedChangesModal,
  useCredentialDetailForm,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  useCreateCredentialDraft,
  useDeleteWorkspaceCredential,
  useWorkspaceCredentials,
  type WorkspaceCredential,
} from '@/hooks/queries/credentials'
import {
  useConnectOAuthService,
  useDisconnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth/oauth-connections'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'

const logger = createLogger('ConnectedCredentialDetail')

interface ConnectedCredentialDetailProps {
  workspaceId: string
  credentialId: string
}

export function ConnectedCredentialDetail({
  workspaceId,
  credentialId,
}: ConnectedCredentialDetailProps) {
  const router = useRouter()
  const integrationsHref = `/workspace/${workspaceId}/integrations`

  useOAuthReturnRouter()

  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  const { data: oauthConnections = [] } = useOAuthConnections()
  const connectOAuthService = useConnectOAuthService()
  const disconnectOAuthService = useDisconnectOAuthService()
  const createDraft = useCreateCredentialDraft()
  const deleteCredential = useDeleteWorkspaceCredential()

  const credential = useMemo<WorkspaceCredential | null>(
    () => credentials.find((c) => c.id === credentialId) ?? null,
    [credentials, credentialId]
  )

  const isAdmin = credential?.role === 'admin'

  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)

  const form = useCredentialDetailForm({ credential, isAdmin, backHref: integrationsHref })

  const oauthServiceNameByProviderId = useMemo(
    () => new Map(oauthConnections.map((service) => [service.providerId, service.name])),
    [oauthConnections]
  )
  const resolveProviderLabel = useCallback(
    (providerId?: string | null): string => {
      if (!providerId) return ''
      return oauthServiceNameByProviderId.get(providerId) || providerId
    },
    [oauthServiceNameByProviderId]
  )

  const serviceConfig = useMemo(() => {
    if (!credential?.providerId) return null
    return getServiceConfigByProviderId(credential.providerId)
  }, [credential])

  /**
   * Resolve the integration block type from the credential's OAuth service so
   * the header tile can render with the same brand background used by the rows
   * on the integrations list page. Several integrations can share one service
   * (e.g. Jira and Jira Service Management); the one named after the service
   * is preferred since it is the service's canonical integration.
   */
  const integrationBlockType = useMemo(() => {
    if (!serviceConfig) return ''
    const candidates = INTEGRATIONS.filter(
      (i) => resolveOAuthServiceForIntegration(i)?.providerId === serviceConfig.providerId
    )
    const serviceName = serviceConfig.name.toLowerCase()
    const canonical = candidates.find((i) => i.name.toLowerCase() === serviceName)
    return (canonical ?? candidates[0])?.type ?? ''
  }, [serviceConfig])

  const handleReconnectOAuth = async () => {
    if (!credential || credential.type !== 'oauth' || !credential.providerId || !workspaceId) return
    try {
      await createDraft.mutateAsync({
        workspaceId,
        providerId: credential.providerId,
        displayName: credential.displayName,
        description: credential.description || undefined,
        credentialId: credential.id,
      })

      const oauthPreCount = credentials.filter(
        (c) => c.type === 'oauth' && c.providerId === credential.providerId
      ).length
      writeOAuthReturnContext({
        origin: 'integrations',
        displayName: credential.displayName,
        providerId: credential.providerId,
        preCount: oauthPreCount,
        workspaceId,
        reconnect: true,
        requestedAt: Date.now(),
      })

      await connectOAuthService.mutateAsync({
        providerId: credential.providerId,
        callbackURL: window.location.href,
      })
    } catch (error: unknown) {
      toast.error("Couldn't start reconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to reconnect OAuth credential', error)
    }
  }

  const handleConfirmDelete = async () => {
    if (!credential) return
    try {
      if (credential.type === 'service_account') {
        await deleteCredential.mutateAsync(credential.id)
      } else {
        if (!credential.accountId || !credential.providerId) {
          toast.error("Can't disconnect", {
            description: 'Missing account information. Try reconnecting this credential first.',
          })
          return
        }
        await disconnectOAuthService.mutateAsync({
          provider: credential.providerId.split('-')[0] || credential.providerId,
          providerId: credential.providerId,
          serviceId: credential.providerId,
          accountId: credential.accountId,
        })
        window.dispatchEvent(
          new CustomEvent('oauth-credentials-updated', {
            detail: { providerId: credential.providerId, workspaceId },
          })
        )
      }
      setShowDeleteConfirmDialog(false)
      router.push(integrationsHref)
    } catch (error) {
      toast.error("Couldn't disconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to disconnect integration', error)
    }
  }

  const back = (
    <ChipLink href={integrationsHref} onClick={form.handleBackClick} leftIcon={ArrowLeft}>
      Integrations
    </ChipLink>
  )

  const actions =
    credential && isAdmin ? (
      <>
        {serviceConfig?.authType !== 'service_account' && (
          <Chip
            onClick={handleReconnectOAuth}
            disabled={connectOAuthService.isPending}
            leftIcon={serviceConfig?.icon}
          >
            Reconnect
          </Chip>
        )}
        <Chip leftIcon={Send} onClick={() => setIsShareModalOpen(true)}>
          Share
        </Chip>
        <Chip
          onClick={() => setShowDeleteConfirmDialog(true)}
          disabled={disconnectOAuthService.isPending || deleteCredential.isPending}
        >
          Disconnect
        </Chip>
        <Chip onClick={form.save} disabled={!form.isDirty || form.isSaving}>
          {form.isSaving ? 'Saving...' : 'Save'}
        </Chip>
      </>
    ) : null

  if (credentialsLoading && !credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <p className='py-12 text-center text-[var(--text-muted)] text-sm'>Loading…</p>
      </CredentialDetailLayout>
    )
  }

  if (!credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <p className='py-12 text-center text-[var(--text-muted)] text-sm'>Credential not found.</p>
      </CredentialDetailLayout>
    )
  }

  const serviceLabel =
    serviceConfig?.name || resolveProviderLabel(credential.providerId) || 'Unknown service'

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={
            serviceConfig ? (
              <IntegrationTile
                blockType={integrationBlockType}
                icon={serviceConfig.icon as ComponentType<{ className?: string }>}
              />
            ) : (
              <div className='flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                <span className='font-medium text-[var(--text-tertiary)] text-small'>
                  {resolveProviderLabel(credential.providerId).slice(0, 1) || '?'}
                </span>
              </div>
            )
          }
          title={serviceLabel}
          subtitle={serviceConfig?.description || 'Connected service'}
        />

        <DetailSection title='Credential ID'>
          <ChipCopyInput id='credential-id' value={credential.id} copyLabel='Copy credential ID' />
        </DetailSection>

        <DetailSection title='Display Name'>
          <ChipInput
            id='credential-display-name'
            value={form.displayNameDraft}
            onChange={(event) => form.setDisplayNameDraft(event.target.value)}
            autoComplete='off'
            data-lpignore='true'
            disabled={!isAdmin}
          />
        </DetailSection>

        <DetailSection title='Description'>
          <ChipTextarea
            id='credential-description'
            rows={4}
            value={form.descriptionDraft}
            onChange={(event) => form.setDescriptionDraft(event.target.value)}
            placeholder='Add a description...'
            maxLength={500}
            autoComplete='off'
            data-lpignore='true'
            disabled={!isAdmin}
          />
        </DetailSection>

        <CredentialMembersSection credentialId={credential.id} isAdmin={isAdmin} />
      </CredentialDetailLayout>

      <ChipConfirmModal
        open={showDeleteConfirmDialog}
        onOpenChange={setShowDeleteConfirmDialog}
        srTitle='Disconnect Integration'
        title='Disconnect Integration'
        text={[
          'Are you sure you want to disconnect ',
          { text: credential.displayName, bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{
          label: 'Disconnect',
          onClick: handleConfirmDelete,
          pending: disconnectOAuthService.isPending || deleteCredential.isPending,
          pendingLabel: 'Disconnecting...',
        }}
      />

      <AddPeopleModal
        credentialId={credential.id}
        open={isShareModalOpen}
        onOpenChange={setIsShareModalOpen}
      />

      <UnsavedChangesModal
        open={form.showUnsavedAlert}
        onOpenChange={form.setShowUnsavedAlert}
        onDiscard={form.confirmDiscard}
      />
    </>
  )
}
