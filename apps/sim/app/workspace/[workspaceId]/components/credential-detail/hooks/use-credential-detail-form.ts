'use client'

import { type MouseEvent, useCallback, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { useUpdateWorkspaceCredential, type WorkspaceCredential } from '@/hooks/queries/credentials'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

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

interface CredentialMetadata {
  displayName: string
  description: string
  unredacted: boolean
}

function sameMetadata(left: CredentialMetadata, right: CredentialMetadata) {
  return (
    left.displayName === right.displayName &&
    left.description === right.description &&
    left.unredacted === right.unredacted
  )
}

interface UseCredentialDetailFormParams {
  workspaceId?: string
  credential: WorkspaceCredential | null
  isAdmin: boolean
  /** Where the back link / discard navigates to. */
  backHref: string
  /**
   * An additional editable section on the page, folded into one dirty state, one
   * save, and one unsaved-changes guard.
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
  const isSaving = updateCredential.isPending || (section?.isSaving ?? false)

  const savedValues = {
    displayName: credential?.displayName ?? '',
    description: credential?.description ?? '',
    unredacted: credential?.unredacted ?? false,
  }
  const [draft, setDraft] = useState<{
    credentialId: string
    baseline: typeof savedValues
    values: typeof savedValues
  } | null>(null)

  if (draft && credential && draft.credentialId !== credential.id) setDraft(null)

  const values = draft?.values ?? savedValues
  const baseline = draft?.baseline ?? savedValues
  const displayNameDraft = values.displayName
  const descriptionDraft = values.description
  const unredactedDraft = values.unredacted
  const isDisplayNameDirty = values.displayName.trim() !== baseline.displayName.trim()
  const isDescriptionDirty = values.description.trim() !== baseline.description.trim()
  const isUnredactedDirty = values.unredacted !== baseline.unredacted
  const isMetadataDirty = isDisplayNameDirty || isDescriptionDirty || isUnredactedDirty

  const updateDraft = useCallback(
    (change: Partial<typeof savedValues>) => {
      if (!credential) return
      setDraft((current) => {
        const baseline = current?.baseline ?? {
          displayName: credential.displayName,
          description: credential.description ?? '',
          unredacted: credential.unredacted,
        }
        const values = { ...(current?.values ?? baseline), ...change }
        if (!isSaving && sameMetadata(values, baseline)) return null
        return { credentialId: credential.id, baseline, values }
      })
    },
    [credential, isSaving]
  )
  const setDisplayNameDraft = useCallback(
    (displayName: string) => updateDraft({ displayName }),
    [updateDraft]
  )
  const setDescriptionDraft = useCallback(
    (description: string) => updateDraft({ description }),
    [updateDraft]
  )
  const setUnredactedDraft = useCallback(
    (unredacted: boolean) => updateDraft({ unredacted }),
    [updateDraft]
  )

  const isSectionDirty = section?.isDirty ?? false
  const isDirty = isMetadataDirty || isSectionDirty
  const router = useRouter()
  const discard = useCallback(() => {
    if (isSaving) return
    setDraft(null)
    section?.discard()
  }, [isSaving, section])

  const guard = useSettingsUnsavedGuard({
    isDirty,
    navigationBlocked: isSaving,
    onDiscard: discard,
  })
  const handleBackClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      const { isDirty, navigationBlocked } = useSettingsDirtyStore.getState()
      if (!isDirty && !navigationBlocked) return
      event.preventDefault()
      guard.guardBack(() => router.push(backHref))
    },
    [guard.guardBack, router, backHref]
  )

  const releaseUnchangedDraft = useCallback(() => {
    setDraft((current) =>
      current && sameMetadata(current.values, current.baseline) ? null : current
    )
  }, [])

  const save = useCallback(async () => {
    if (!credential || isSaving) return
    const submitted = draft
    if (isSectionDirty && !(await section?.save())) {
      releaseUnchangedDraft()
      return
    }
    if (!isAdmin || !isMetadataDirty) {
      releaseUnchangedDraft()
      return
    }

    try {
      await updateCredential.mutateAsync({
        credentialId: credential.id,
        ...(isDisplayNameDirty ? { displayName: displayNameDraft.trim() } : {}),
        ...(isDescriptionDirty ? { description: descriptionDraft.trim() || null } : {}),
        ...(isUnredactedDirty ? { unredacted: unredactedDraft } : {}),
      })
      setDraft((current) => {
        if (current === submitted) return null
        if (!current || !submitted || current.credentialId !== submitted.credentialId)
          return current
        return {
          ...current,
          baseline: {
            displayName: submitted.values.displayName.trim(),
            description: submitted.values.description.trim(),
            unredacted: submitted.values.unredacted,
          },
        }
      })
    } catch (error) {
      releaseUnchangedDraft()
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to save credential details', error)
    }
  }, [
    credential,
    draft,
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
    releaseUnchangedDraft,
  ])

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
    handleBackClick,
  }
}
