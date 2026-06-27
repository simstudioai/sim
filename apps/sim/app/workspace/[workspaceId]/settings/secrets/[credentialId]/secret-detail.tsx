'use client'

import { useState } from 'react'
import { Chip, ChipCopyInput, ChipLink, Send } from '@/components/emcn'
import { ArrowLeft, Key } from '@/components/emcn/icons'
import {
  AddPeopleModal,
  CredentialDetailHeading,
  CredentialDetailLayout,
  CredentialMembersSection,
  DetailIconTile,
  DetailSection,
  UnsavedChangesModal,
  useUnsavedChangesGuard,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field'
import { useSecretValue } from '@/app/workspace/[workspaceId]/settings/components/secrets/hooks/use-secret-value'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'
import { useTranslations } from 'next-intl'

interface SecretDetailProps {
  workspaceId: string
  credentialId: string
}

export function SecretDetail({ workspaceId, credentialId }: SecretDetailProps) {
  const t = useTranslations('auto')
  const secretsHref = `/workspace/${workspaceId}/settings/secrets`

  const { data: credential = null, isPending } = useWorkspaceCredential(credentialId)
  const isAdmin = credential?.role === 'admin'
  const isPersonal = credential?.type === 'env_personal'

  const [isShareModalOpen, setIsShareModalOpen] = useState(false)

  const valueField = useSecretValue({ workspaceId, credential })
  const guard = useUnsavedChangesGuard({ isDirty: valueField.isDirty, backHref: secretsHref })

  const back = (
    <ChipLink href={secretsHref} onClick={guard.handleBackClick} leftIcon={ArrowLeft}>
      {t('secrets')}
    </ChipLink>
  )

  const canEditValue = valueField.canEdit && !valueField.isConflicted

  const actions =
    credential && ((isAdmin && !isPersonal) || canEditValue) ? (
      <>
        {isAdmin && !isPersonal && (
          <Chip leftIcon={Send} onClick={() => setIsShareModalOpen(true)}>
            {t('share')}
          </Chip>
        )}
        {canEditValue && (
          <Chip onClick={valueField.save} disabled={!valueField.isDirty || valueField.isSaving}>
            {valueField.isSaving ? 'Saving...' : 'Save'}
          </Chip>
        )}
      </>
    ) : null

  if (isPending && !credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <p className='py-12 text-center text-[var(--text-muted)] text-sm'>{t('loading')}</p>
      </CredentialDetailLayout>
    )
  }

  if (!credential) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <p className='py-12 text-center text-[var(--text-muted)] text-sm'>{t('secret_not_found')}</p>
      </CredentialDetailLayout>
    )
  }

  return (
    <>
      <CredentialDetailLayout back={back} actions={actions}>
        <CredentialDetailHeading
          leading={<DetailIconTile icon={Key} />}
          title={credential.envKey || credential.displayName}
          subtitle={
            isPersonal
              ? valueField.isConflicted
                ? 'Overridden by a workspace variable'
                : 'Personal secret'
              : 'Workspace secret'
          }
        />

        <DetailSection title={t('key')}>
          <ChipCopyInput value={credential.envKey || ''} copyLabel='Copy key' />
        </DetailSection>

        <DetailSection title={t('value')}>
          <SecretValueField
            value={valueField.value}
            onChange={valueField.setValue}
            canEdit={valueField.canEdit}
            unmasked={valueField.isConflicted}
            readOnly={valueField.isConflicted}
            placeholder={t('enter_value')}
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
