'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipCopyInput,
  ChipInput,
  ChipLink,
  ChipTextarea,
  cn,
  toast,
} from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { SaveDiscardChips } from '@/components/settings/save-discard-actions'
import { writeOAuthReturnContext } from '@/lib/credentials/client-state'
import { resolveCredentialDisplay } from '@/lib/integrations'
import {
  CredentialDetailHeading,
  CredentialDetailLayout,
  DetailSection,
  UnsavedChangesModal,
  useCredentialDetailForm,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  RESOURCE_TILE_BASE,
  RESOURCE_TILE_PLAIN,
} from '@/app/workspace/[workspaceId]/components/resource-tile'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { useSearchCredentials } from '@/app/workspace/[workspaceId]/search/hooks/use-search-credentials'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useCreateCredentialDraft, useDeleteWorkspaceCredential } from '@/hooks/queries/credentials'
import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'

const logger = createLogger('SearchCredentialDetail')

interface SearchCredentialDetailProps {
  workspaceId: string
  credentialId: string
}

/**
 * A connected Sim Search credential: the integrations connected-credential page
 * without its sharing. Connections here are personal, so there is no Share
 * action and no members section — the credential resolves only when the viewer
 * created it, and anyone else lands on "not found". Reconnect and Disconnect
 * go through the same credential draft and delete paths as integrations.
 */
export function SearchCredentialDetail({ workspaceId, credentialId }: SearchCredentialDetailProps) {
  const router = useRouter()
  const searchHref = `/workspace/${workspaceId}/search`

  useOAuthReturnRouter()

  const { credentials, isPending: credentialsLoading } = useSearchCredentials(workspaceId)
  const connectOAuthService = useConnectOAuthService()
  const createDraft = useCreateCredentialDraft()
  const deleteCredential = useDeleteWorkspaceCredential()

  const credential = credentials.find((c) => c.id === credentialId) ?? null
  const isAdmin = credential?.role === 'admin'

  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)

  const form = useCredentialDetailForm({ credential, isAdmin, backHref: searchHref })

  const display = credential ? resolveCredentialDisplay(credential) : null

  const handleReconnect = async () => {
    if (!credential?.providerId) return
    try {
      const draft = await createDraft.mutateAsync({
        workspaceId,
        providerId: credential.providerId,
        displayName: credential.displayName,
        description: credential.description || undefined,
        credentialId: credential.id,
      })
      writeOAuthReturnContext({
        origin: 'integrations',
        displayName: credential.displayName,
        providerId: credential.providerId,
        preCount: credentials.filter((c) => c.providerId === credential.providerId).length,
        workspaceId,
        reconnect: true,
        requestedAt: Date.now(),
      })
      await connectOAuthService.mutateAsync({
        providerId: credential.providerId,
        callbackURL: window.location.href,
        draftId: draft.draftId,
      })
    } catch (error: unknown) {
      toast.error("Couldn't start reconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to reconnect Sim Search credential', error)
    }
  }

  const handleConfirmDelete = async () => {
    if (!credential) return
    try {
      await deleteCredential.mutateAsync(credential.id)
      setShowDeleteConfirmDialog(false)
      router.push(searchHref)
    } catch (error) {
      toast.error("Couldn't disconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to disconnect Sim Search credential', error)
    }
  }

  const back = (
    <ChipLink href={searchHref} onClick={form.handleBackClick} leftIcon={ArrowLeft}>
      Search
    </ChipLink>
  )

  const actions =
    credential && isAdmin ? (
      <>
        <Chip
          onClick={handleReconnect}
          disabled={createDraft.isPending || connectOAuthService.isPending}
          leftIcon={display?.icon ?? undefined}
        >
          Reconnect
        </Chip>
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

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={
            display?.icon ? (
              <IntegrationTile blockType={display.blockType} icon={display.icon} />
            ) : (
              <div className={cn(RESOURCE_TILE_BASE, RESOURCE_TILE_PLAIN)}>
                <span className='text-[var(--text-tertiary)] text-small'>
                  {credential.displayName.slice(0, 1) || '?'}
                </span>
              </div>
            )
          }
          title={display?.detailTitle ?? credential.displayName}
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
      </CredentialDetailLayout>

      <ChipConfirmModal
        open={showDeleteConfirmDialog}
        onOpenChange={setShowDeleteConfirmDialog}
        srTitle='Disconnect Connector'
        title='Disconnect Connector'
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

      <UnsavedChangesModal
        open={form.showUnsavedAlert}
        onOpenChange={form.setShowUnsavedAlert}
        onDiscard={form.confirmDiscard}
      />
    </>
  )
}
