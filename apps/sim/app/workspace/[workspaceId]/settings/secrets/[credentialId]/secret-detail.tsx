'use client'

import { useState } from 'react'
import { Chip, ChipCopyInput, ChipLink, Send } from '@sim/emcn'
import { ArrowLeft, Key } from '@sim/emcn/icons'
import { SaveDiscardChips } from '@/components/settings/save-discard-actions'
import { ResourceTile } from '@/app/workspace/[workspaceId]/components'
import {
  AddPeopleModal,
  CredentialDetailHeading,
  CredentialDetailLayout,
  CredentialMembersSection,
  DetailSection,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field'
import { useSecretValue } from '@/app/workspace/[workspaceId]/settings/components/secrets/hooks/use-secret-value'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'

interface SecretDetailProps {
  workspaceId: string
  credentialId: string
}

export function SecretDetail({ workspaceId, credentialId }: SecretDetailProps) {
  const secretsHref = `/workspace/${workspaceId}/settings/secrets`

  const { data: credential = null, isPending } = useWorkspaceCredential(credentialId)
  const isAdmin = credential?.role === 'admin'
  const isPersonal = credential?.type === 'env_personal'

  const [isShareModalOpen, setIsShareModalOpen] = useState(false)

  const valueField = useSecretValue({ workspaceId, credential })
  const guard = useUnsavedChangesGuard({ isDirty: valueField.isDirty, backHref: secretsHref })

  const back = (
    <ChipLink href={secretsHref} onClick={guard.handleBackClick} leftIcon={ArrowLeft}>
      Secrets
    </ChipLink>
  )

  const canEditValue = valueField.canEdit && !valueField.isConflicted

  const actions =
    credential && ((isAdmin && !isPersonal) || canEditValue) ? (
      <>
        {isAdmin && !isPersonal && (
          <Chip leftIcon={Send} onClick={() => setIsShareModalOpen(true)}>
            Share
          </Chip>
        )}
        {canEditValue && (
          <SaveDiscardChips
            dirty={valueField.isDirty}
            saving={valueField.isSaving}
            onSave={valueField.save}
            onDiscard={valueField.discard}
          />
        )}
      </>
    ) : null

  if (isPending && !credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
      </CredentialDetailLayout>
    )
  }

  if (!credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline'>Secret not found.</SettingsEmptyState>
      </CredentialDetailLayout>
    )
  }

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={<ResourceTile icon={Key} />}
          title={credential.envKey || credential.displayName}
          subtitle={
            isPersonal
              ? valueField.isConflicted
                ? 'Overridden by a workspace variable'
                : 'Personal secret'
              : 'Workspace secret'
          }
        />

        <DetailSection title='Key'>
          <ChipCopyInput value={credential.envKey || ''} copyLabel='Copy key' />
        </DetailSection>

        <DetailSection title='Value'>
          <SecretValueField
            value={valueField.value}
            onChange={valueField.setValue}
            canEdit={valueField.canEdit}
            unmasked={valueField.isConflicted}
            readOnly={valueField.isConflicted}
            placeholder='Enter value'
          />
        </DetailSection>

        {!isPersonal && <CredentialMembersSection credentialId={credential.id} isAdmin={isAdmin} />}
      </CredentialDetailLayout>

      {!isPersonal && (
        <AddPeopleModal
          credentialId={credential.id}
          open={isShareModalOpen}
          onOpenChange={setIsShareModalOpen}
        />
      )}

      <UnsavedChangesModal
        open={guard.showUnsavedAlert}
        onOpenChange={guard.setShowUnsavedAlert}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
