'use client'

import { type ComponentType, useCallback, useMemo, useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipCopyInput,
  ChipInput,
  ChipLink,
  ChipTextarea,
  cn,
  Send,
  toast,
} from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { SaveDiscardChips } from '@/components/settings/save-discard-actions'
import { writeOAuthReturnContext } from '@/lib/credentials/client-state'
import { resolveCredentialDisplay } from '@/lib/integrations'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import {
  AddPeopleModal,
  CredentialDetailHeading,
  CredentialDetailLayout,
  CredentialMembersSection,
  DetailSection,
  UnsavedChangesModal,
  useCredentialDetailForm,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  RESOURCE_TILE_BASE,
  RESOURCE_TILE_PLAIN,
} from '@/app/workspace/[workspaceId]/components/resource-tile'
import { ConnectPersonalTokenModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-personal-token-modal'
import {
  ConnectServiceAccountModal,
  type ServiceAccountProviderId,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useCreateCredentialDraft,
  useDeleteWorkspaceCredential,
  useWorkspaceCredentials,
  type WorkspaceCredential,
} from '@/hooks/queries/credentials'
import {
  assertMicrosoftDataverseReconnectAvailable,
  useConnectMicrosoftDataverseOAuthService,
  useMicrosoftDataverseCredentialBinding,
} from '@/hooks/queries/oauth/microsoft-dataverse-connections'
import {
  useConnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth/oauth-connections'
import { useOAuthCredentialDetail } from '@/hooks/queries/oauth/oauth-credentials'
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
  const createDraft = useCreateCredentialDraft()
  const deleteCredential = useDeleteWorkspaceCredential(workspaceId)

  const credential = useMemo<WorkspaceCredential | null>(
    () => credentials.find((c) => c.id === credentialId) ?? null,
    [credentials, credentialId]
  )
  const isDataverseCredential =
    credential?.type === 'oauth' && credential.providerId === 'microsoft-dataverse'
  const dataverseCredentialQuery = useOAuthCredentialDetail(
    isDataverseCredential ? credentialId : undefined,
    undefined,
    isDataverseCredential
  )
  const dataverseBinding = useMicrosoftDataverseCredentialBinding({
    isPending: dataverseCredentialQuery.isPending,
    providerId: credential?.type === 'oauth' ? (credential.providerId ?? undefined) : undefined,
    scopes: dataverseCredentialQuery.data?.[0]?.scopes,
  })
  const connectMicrosoftDataverseOAuthService = useConnectMicrosoftDataverseOAuthService()
  const isAdmin = credential?.role === 'admin'

  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [reconnectOpen, setReconnectOpen] = useState(false)

  const form = useCredentialDetailForm({
    credential,
    isAdmin,
    backHref: integrationsHref,
    workspaceId,
  })

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

  const display = useMemo(
    () => (credential ? resolveCredentialDisplay(credential) : null),
    [credential]
  )
  const serviceConfig = display?.service ?? null
  const integrationBlockType = display?.blockType ?? ''

  const handleReconnectOAuth = async () => {
    if (!credential || credential.type !== 'oauth' || !credential.providerId || !workspaceId) return
    try {
      if (isDataverseCredential) {
        assertMicrosoftDataverseReconnectAvailable({
          bindingState: dataverseBinding.state,
          credentialQueryFailed: dataverseCredentialQuery.isError,
        })
      }

      const draft = await createDraft.mutateAsync({
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

      if (dataverseBinding.state === 'bound' && dataverseBinding.environmentUrl) {
        await connectMicrosoftDataverseOAuthService.mutateAsync({
          callbackURL: window.location.href,
          draftId: draft.draftId,
          environmentUrl: dataverseBinding.environmentUrl,
        })
      } else {
        await connectOAuthService.mutateAsync({
          providerId: credential.providerId,
          callbackURL: window.location.href,
          draftId: draft.draftId,
        })
      }
    } catch (error: unknown) {
      toast.error("Couldn't start reconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to reconnect OAuth credential', error)
    }
  }

  /**
   * Every credential type disconnects through the workspace-scoped credential
   * delete, which authorizes against credential admin — explicit members and
   * derived workspace admins alike.
   */
  const handleConfirmDelete = async () => {
    if (!credential) return
    try {
      await deleteCredential.mutateAsync(credential.id)
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
        {(credential.type === 'oauth' ||
          credential.type === 'service_account' ||
          credential.type === 'personal_token') && (
          <Chip
            onClick={
              credential.type === 'service_account' || credential.type === 'personal_token'
                ? () => setReconnectOpen(true)
                : credential.providerId === 'quickbooks'
                  ? () => setReconnectOpen(true)
                  : handleReconnectOAuth
            }
            disabled={
              connectOAuthService.isPending ||
              connectMicrosoftDataverseOAuthService.isPending ||
              dataverseBinding.isPending
            }
            leftIcon={display?.icon ?? undefined}
          >
            Reconnect
          </Chip>
        )}
        {credential.type !== 'personal_token' && (
          <Chip leftIcon={Send} onClick={() => setIsShareModalOpen(true)}>
            Share
          </Chip>
        )}
        <Chip
          onClick={() => setShowDeleteConfirmDialog(true)}
          disabled={deleteCredential.isPending}
        >
          Disconnect
        </Chip>
        <SaveDiscardChips
          dirty={form.isDirty}
          saving={form.isSaving}
          onSave={form.save}
          onDiscard={form.discard}
        />
      </>
    ) : null

  if (credentialsLoading && !credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
      </CredentialDetailLayout>
    )
  }

  if (!credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline'>Credential not found.</SettingsEmptyState>
      </CredentialDetailLayout>
    )
  }

  const headingTitle =
    display?.detailTitle || resolveProviderLabel(credential.providerId) || 'Unknown service'

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={
            display?.icon ? (
              <IntegrationTile blockType={integrationBlockType} icon={display.icon} />
            ) : (
              <div className={cn(RESOURCE_TILE_BASE, RESOURCE_TILE_PLAIN)}>
                <span className='text-[var(--text-tertiary)] text-small'>
                  {resolveProviderLabel(credential.providerId).slice(0, 1) || '?'}
                </span>
              </div>
            )
          }
          title={headingTitle}
          subtitle={display?.detailSubtitle ?? 'Connected service'}
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

        {credential.type !== 'personal_token' && (
          <CredentialMembersSection credentialId={credential.id} isAdmin={isAdmin} />
        )}
        {credential.type === 'personal_token' && credential.instanceUrl && (
          <DetailSection title='GitLab instance'>
            <ChipCopyInput value={credential.instanceUrl} copyLabel='Copy GitLab instance' />
          </DetailSection>
        )}
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
          pending: deleteCredential.isPending,
          pendingLabel: 'Disconnecting...',
        }}
      />

      {credential.type !== 'personal_token' && (
        <AddPeopleModal
          credentialId={credential.id}
          open={isShareModalOpen}
          onOpenChange={setIsShareModalOpen}
        />
      )}

      <UnsavedChangesModal
        open={form.showUnsavedAlert}
        onOpenChange={form.setShowUnsavedAlert}
        onDiscard={form.confirmDiscard}
      />

      {credential.type === 'personal_token' && (
        <ConnectPersonalTokenModal
          open={reconnectOpen}
          onOpenChange={setReconnectOpen}
          workspaceId={workspaceId}
          credentialId={credential.id}
          instanceUrl={credential.instanceUrl}
        />
      )}
      {credential.type === 'service_account' && credential.providerId && (
        <ConnectServiceAccountModal
          open={reconnectOpen}
          onOpenChange={setReconnectOpen}
          workspaceId={workspaceId}
          serviceAccountProviderId={credential.providerId as ServiceAccountProviderId}
          serviceName={display?.familyName || serviceConfig?.name || credential.displayName}
          serviceIcon={display?.icon as ComponentType<{ className?: string }>}
          credentialId={credential.id}
          credentialDisplayName={credential.displayName}
          credentialDescription={credential.description ?? undefined}
        />
      )}

      {credential.type === 'oauth' && credential.providerId === 'quickbooks' && (
        <ConnectOAuthModal
          open={reconnectOpen}
          onOpenChange={setReconnectOpen}
          mode='reauthorize'
          providerId={credential.providerId}
          serviceName={display?.familyName || serviceConfig?.name || credential.displayName}
          serviceIcon={display?.icon as ComponentType<{ className?: string }>}
          toolName='QuickBooks'
          requiredScopes={serviceConfig?.scopes ?? []}
          reconnectTarget={{
            workspaceId,
            credentialId: credential.id,
            displayName: credential.displayName,
          }}
        />
      )}
    </>
  )
}
