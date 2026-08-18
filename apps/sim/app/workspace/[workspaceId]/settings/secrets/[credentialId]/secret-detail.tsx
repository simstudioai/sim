'use client'

import { useState } from 'react'
import { Chip, ChipCopyInput, ChipLink, ChipTextarea } from '@sim/emcn'
import { ArrowLeft, Clock, Key, Send } from '@sim/emcn/icons'
import { useQueryState } from 'nuqs'
import { SaveDiscardChips } from '@/components/settings/save-discard-actions'
import { SettingsActionChips } from '@/components/settings/settings-header'
import { isApiClientError } from '@/lib/api/client/errors'
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
import { SecretUsagePanel } from '@/app/workspace/[workspaceId]/settings/secrets/[credentialId]/components/secret-usage-panel'
import {
  secretDetailViewParam,
  secretDetailViewUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/secrets/[credentialId]/search-params'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'

interface SecretDetailProps {
  workspaceId: string
  credentialId: string
}

export function SecretDetail({ workspaceId, credentialId }: SecretDetailProps) {
  const secretsHref = `/workspace/${workspaceId}/settings/secrets`

  const { data: credential = null, isPending, error } = useWorkspaceCredential(credentialId)
  const isAdmin = credential?.role === 'admin'
  const isPersonal = credential?.type === 'env_personal'

  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [view, setView] = useQueryState(secretDetailViewParam.key, {
    ...secretDetailViewParam.parser,
    ...secretDetailViewUrlKeys,
  })

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

  /**
   * Usage names workflows, people, and run ids — the same slice value masking withholds — so
   * it is gated on the same predicate that reveals the value: admin of a workspace secret,
   * owner of a personal one. `canEdit` is exactly that predicate. Deliberately not
   * `canEditValue`: a personal secret shadowed by a workspace variable is read-only, but it
   * is still its owner's to audit.
   *
   * A member who cannot see it gets a disabled chip rather than no chip, so the capability is
   * discoverable and the reason is stated instead of silently missing.
   */
  const canViewUsage = valueField.canEdit

  const actions = credential ? (
    <>
      <SettingsActionChips
        actions={[
          {
            id: 'usage',
            text: 'See usage',
            icon: Clock,
            onSelect: () => void setView('usage'),
            disabled: !canViewUsage,
            ...(canViewUsage
              ? {}
              : {
                  tooltip: isPersonal
                    ? 'Only the owner of this secret can see its usage'
                    : 'Only admins of this secret can see its usage',
                }),
          },
          ...(isWorkspaceSecretAdmin
            ? [
                {
                  id: 'share',
                  text: 'Share',
                  icon: Send,
                  onSelect: () => setIsShareModalOpen(true),
                },
              ]
            : []),
        ]}
      />
      {(isWorkspaceSecretAdmin || canEditValue) && (
        <SaveDiscardChips
          dirty={form.isDirty}
          saving={form.isSaving}
          onSave={form.save}
          onDiscard={form.discard}
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

  /**
   * A failed load is not a missing secret. Every outcome used to render "Secret not found",
   * so a permission failure or an unreachable API was indistinguishable from a deleted
   * credential — and the one message sent you looking for the wrong problem.
   */
  if (error && !(isApiClientError(error) && error.status === 404)) {
    return (
      <CredentialDetailLayout back={back} actions={actions}>
        <SettingsEmptyState variant='inline' tone='error'>
          {isApiClientError(error) && error.status === 403
            ? 'You do not have access to this secret.'
            : 'Could not load this secret.'}
        </SettingsEmptyState>
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

  /**
   * Usage is a destination reached from the header, the same shape as the Forks tab's
   * "See activity" — it replaces the secret rather than expanding inside it, so the two
   * readings never compete for the same column. Back returns with `replace`, since opening
   * already pushed.
   */
  if (canViewUsage && view === 'usage') {
    return (
      <CredentialDetailLayout
        back={
          <Chip leftIcon={ArrowLeft} onClick={() => void setView(null, { history: 'replace' })}>
            {credential.envKey || credential.displayName}
          </Chip>
        }
      >
        <CredentialDetailHeading
          leading={<ResourceTile icon={Clock} />}
          title='Usage'
          subtitle={credential.envKey || credential.displayName}
        />
        <SecretUsagePanel
          workspaceId={workspaceId}
          secretName={credential.envKey || ''}
          scope={isPersonal ? 'personal' : 'workspace'}
        />
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
