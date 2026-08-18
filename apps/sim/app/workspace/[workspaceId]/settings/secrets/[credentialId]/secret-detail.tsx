'use client'

import { useState } from 'react'
import { Chip, ChipCopyInput, ChipLink, ChipTextarea } from '@sim/emcn'
import { ArrowLeft, Key, Send } from '@sim/emcn/icons'
import { SaveDiscardChips } from '@/components/settings/save-discard-actions'
import { ResourceTile } from '@/app/workspace/[workspaceId]/components'
import {
  AddPeopleModal,
  CredentialDetailHeading,
  CredentialDetailLayout,
  CredentialMembersSection,
  DetailSection,
  UnsavedChangesModal,
  useCredentialDetailForm,
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

  /**
   * Description is workspace-only because `env_personal` credentials are
   * per-workspace mirrors of one user-global secret, so one saved here would
   * exist in this workspace alone — and a personal secret has no teammates to
   * inform. Gates the write and the render alike, so the two cannot disagree.
   */
  const isWorkspaceSecretAdmin = isAdmin && !isPersonal

  const form = useCredentialDetailForm({
    credential,
    isAdmin: isWorkspaceSecretAdmin,
    backHref: secretsHref,
    section: valueField,
  })

  const back = (
    <ChipLink href={secretsHref} onClick={form.handleBackClick} leftIcon={ArrowLeft}>
      Secrets
    </ChipLink>
  )

  const canEditValue = valueField.canEdit && !valueField.isConflicted

  const actions =
    credential && (isWorkspaceSecretAdmin || canEditValue) ? (
      <>
        {isWorkspaceSecretAdmin && (
          <Chip leftIcon={Send} onClick={() => setIsShareModalOpen(true)}>
            Share
          </Chip>
        )}
        <SaveDiscardChips
          dirty={form.isDirty}
          saving={form.isSaving}
          onSave={form.save}
          onDiscard={form.discard}
        />
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

        {!isPersonal && (
          <DetailSection title='Description'>
            <ChipTextarea
              id='secret-description'
              rows={4}
              value={form.descriptionDraft}
              onChange={(event) => form.setDescriptionDraft(event.target.value)}
              placeholder='Add a description...'
              maxLength={500}
              autoComplete='off'
              data-lpignore='true'
              viewOnly={!isWorkspaceSecretAdmin}
            />
          </DetailSection>
        )}

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
        open={form.showUnsavedAlert}
        onOpenChange={form.setShowUnsavedAlert}
        onDiscard={form.confirmDiscard}
      />
    </>
  )
}
