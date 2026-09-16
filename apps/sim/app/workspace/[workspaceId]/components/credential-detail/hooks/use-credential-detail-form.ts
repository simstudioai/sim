'use client'

import { useCallback, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useUnsavedChangesGuard } from '@/app/workspace/[workspaceId]/components/credential-detail/hooks/use-unsaved-changes-guard'
import { useUpdateWorkspaceCredential, type WorkspaceCredential } from '@/hooks/queries/credentials'

const logger = createLogger('CredentialDetailForm')

/**
 * A second editable section rendered on the same detail page (e.g. a secret's
 * value), whose lifecycle is folded into the form's.
 */
export interface CredentialDetailFormSection {
  isDirty: boolean
  isSaving: boolean
  /**
   * Resolves true when the caller may proceed — including when there was nothing
   * to write. False only when a write was attempted and failed, which stops the
   * metadata save from committing alone.
   */
  save: () => Promise<boolean>
  discard: () => void
}

interface UseCredentialDetailFormParams {
  workspaceId?: string
  credential: WorkspaceCredential | null
  isAdmin: boolean
  /** Where the back link / discard navigates to. */
  backHref: string
  /**
   * An additional editable section on the page, folded into one dirty state, one
   * save, and one unsaved-changes guard. Two independent guards on a page cannot
   * coexist: each seeds its own same-URL history entry while dirty, so Back would
   * pop only one of them and leave the other stranded.
   */
  section?: CredentialDetailFormSection
}

/**
 * Shared editable-metadata controller for a credential detail page: Display Name
 * and Description drafts seeded from the credential, dirty tracking, an
 * admin-only save, and the shared unsaved-changes guard. An optional
 * {@link CredentialDetailFormSection} folds a second editor on the same page
 * into that one save and one guard.
 */
export function useCredentialDetailForm({
  workspaceId,
  credential,
  isAdmin,
  backHref,
  section,
}: UseCredentialDetailFormParams) {
  const updateCredential = useUpdateWorkspaceCredential(workspaceId)

  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [unredactedDraft, setUnredactedDraft] = useState(false)
  const [seededCredentialId, setSeededCredentialId] = useState<string | null>(null)

  // Seed drafts when the credential first resolves (or the route id changes); a
  // background refetch of the same credential must not clobber an in-progress
  // edit — Discard is the one way to reset.
  /** Applies a credential to every draft — the one definition of "reset to server state". */
  const seedDrafts = useCallback((source: WorkspaceCredential) => {
    setDisplayNameDraft(source.displayName)
    setDescriptionDraft(source.description ?? '')
    setUnredactedDraft(source.unredacted)
  }, [])

  if (credential && credential.id !== seededCredentialId) {
    setSeededCredentialId(credential.id)
    seedDrafts(credential)
  }

  const isDisplayNameDirty = credential ? displayNameDraft !== credential.displayName : false
  const isDescriptionDirty = credential
    ? descriptionDraft !== (credential.description || '')
    : false
  const isUnredactedDirty = credential ? unredactedDraft !== credential.unredacted : false
  const isMetadataDirty = isDisplayNameDirty || isDescriptionDirty || isUnredactedDirty
  const isSectionDirty = section?.isDirty ?? false
  const isDirty = isMetadataDirty || isSectionDirty
  const isSaving = updateCredential.isPending || (section?.isSaving ?? false)

  const guard = useUnsavedChangesGuard({ isDirty, backHref })

  const save = useCallback(async () => {
    if (!credential || isSaving) return
    if (isSectionDirty && !(await section?.save())) return
    if (!isAdmin || !isMetadataDirty) return

    try {
      await updateCredential.mutateAsync({
        credentialId: credential.id,
        ...(isDisplayNameDirty ? { displayName: displayNameDraft.trim() } : {}),
        ...(isDescriptionDirty ? { description: descriptionDraft.trim() || null } : {}),
        ...(isUnredactedDirty ? { unredacted: unredactedDraft } : {}),
      })
      if (isDisplayNameDirty) setDisplayNameDraft((value) => value.trim())
      if (isDescriptionDirty) setDescriptionDraft((value) => value.trim())
    } catch (error) {
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to save credential details', error)
    }
  }, [
    credential,
    isAdmin,
    isMetadataDirty,
    isSectionDirty,
    isSaving,
    section,
    isDisplayNameDirty,
    isDescriptionDirty,
    isUnredactedDirty,
    displayNameDraft,
    descriptionDraft,
    unredactedDraft,
    updateCredential.mutateAsync,
  ])

  const discard = useCallback(() => {
    if (credential) seedDrafts(credential)
    section?.discard()
  }, [credential, section, seedDrafts])

  return {
    displayNameDraft,
    setDisplayNameDraft,
    descriptionDraft,
    setDescriptionDraft,
    unredactedDraft,
    setUnredactedDraft,
    isDirty,
    save,
    discard,
    isSaving,
    handleBackClick: guard.handleBackClick,
    showUnsavedAlert: guard.showUnsavedAlert,
    setShowUnsavedAlert: guard.setShowUnsavedAlert,
    confirmDiscard: guard.confirmDiscard,
  }
}
