'use client'

import { useCallback, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useUpdateWorkspaceCredential, type WorkspaceCredential } from '@/hooks/queries/credentials'
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard'

const logger = createLogger('CredentialDetailForm')

interface UseCredentialDetailFormParams {
  credential: WorkspaceCredential | null
  isAdmin: boolean
  /** Where the back link / discard navigates to. */
  backHref: string
}

/**
 * Shared editable-metadata controller for a credential detail page: Display Name
 * and Description drafts seeded from the credential, dirty tracking, an
 * admin-only save, and the shared unsaved-changes guard.
 */
export function useCredentialDetailForm({
  credential,
  isAdmin,
  backHref,
}: UseCredentialDetailFormParams) {
  const updateCredential = useUpdateWorkspaceCredential()

  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [seededCredentialId, setSeededCredentialId] = useState<string | null>(null)

  // Seed drafts when the credential first resolves (or the route id changes); a
  // background refetch of the same credential must not clobber an in-progress
  // edit — Discard is the one way to reset.
  /** Applies a credential to both drafts — the one definition of "reset to server state". */
  const seedDrafts = useCallback((source: WorkspaceCredential) => {
    setDisplayNameDraft(source.displayName)
    setDescriptionDraft(source.description ?? '')
  }, [])

  if (credential && credential.id !== seededCredentialId) {
    setSeededCredentialId(credential.id)
    seedDrafts(credential)
  }

  const isDisplayNameDirty = credential ? displayNameDraft !== credential.displayName : false
  const isDescriptionDirty = credential
    ? descriptionDraft !== (credential.description || '')
    : false
  const isDirty = isDisplayNameDirty || isDescriptionDirty

  const guard = useUnsavedChangesGuard({ isDirty, backHref })

  const save = useCallback(async () => {
    if (!credential || !isAdmin || !isDirty || updateCredential.isPending) return
    try {
      await updateCredential.mutateAsync({
        credentialId: credential.id,
        ...(isDisplayNameDirty ? { displayName: displayNameDraft.trim() } : {}),
        ...(isDescriptionDirty ? { description: descriptionDraft.trim() || null } : {}),
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
    isDirty,
    isDisplayNameDirty,
    isDescriptionDirty,
    displayNameDraft,
    descriptionDraft,
    updateCredential.mutateAsync,
    updateCredential.isPending,
  ])

  const discard = useCallback(() => {
    if (credential) seedDrafts(credential)
  }, [credential, seedDrafts])

  return {
    displayNameDraft,
    setDisplayNameDraft,
    descriptionDraft,
    setDescriptionDraft,
    isDirty,
    save,
    discard,
    isSaving: updateCredential.isPending,
    handleBackClick: guard.handleBackClick,
    showUnsavedAlert: guard.showUnsavedAlert,
    setShowUnsavedAlert: guard.setShowUnsavedAlert,
    confirmDiscard: guard.confirmDiscard,
  }
}
