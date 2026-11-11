'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
import { toast } from '@/lib/toast/sink'
import { useUpdateWorkspaceCredential, type WorkspaceCredential } from '@/hooks/queries/credentials'

const logger = createLogger('CredentialDetailForm')

/**
 * A second editor on the same detail page (a secret's value), folded into the form's one dirty
 * state and save.
 */
interface CredentialDetailFormSection {
  isDirty: boolean
  isSaving: boolean
  /** False only when a write was attempted and failed, which stops the metadata save. */
  save: () => Promise<boolean>
  discard: () => void
}

interface CredentialMetadata {
  displayName: string
  description: string
  unredacted: boolean
}

interface UseCredentialDetailFormParams {
  credential: WorkspaceCredential | null
  isAdmin: boolean
  section?: CredentialDetailFormSection
}

/**
 * A credential detail page's editable metadata: drafts seeded from the credential, dirty tracking
 * and an admin-only save, with `section` folded into both. The page's `SettingsSaveBar` registers
 * the draft with the Settings leave guard.
 */
export function useCredentialDetailForm({
  credential,
  isAdmin,
  section,
}: UseCredentialDetailFormParams) {
  const updateCredential = useUpdateWorkspaceCredential()
  const isSaving = updateCredential.isPending || (section?.isSaving ?? false)

  const savedValues = {
    displayName: credential?.displayName ?? '',
    description: credential?.description ?? '',
    unredacted: credential?.unredacted ?? false,
  }
  const [draft, setDraft] = useState<{
    credentialId: string
    values: Partial<CredentialMetadata>
  } | null>(null)

  if (draft && credential && draft.credentialId !== credential.id) setDraft(null)

  const values = { ...savedValues, ...draft?.values }
  const isDisplayNameDirty = values.displayName.trim() !== savedValues.displayName.trim()
  const isDescriptionDirty = values.description.trim() !== savedValues.description.trim()
  const isUnredactedDirty = values.unredacted !== savedValues.unredacted
  const isMetadataDirty = isDisplayNameDirty || isDescriptionDirty || isUnredactedDirty

  if (
    draft &&
    !isSaving &&
    values.displayName === savedValues.displayName &&
    values.description === savedValues.description &&
    values.unredacted === savedValues.unredacted
  )
    setDraft(null)

  const updateDraft = useCallback(
    (change: Partial<CredentialMetadata>) => {
      if (!credential) return
      setDraft((current) => {
        const saved = {
          displayName: credential.displayName,
          description: credential.description ?? '',
          unredacted: credential.unredacted,
        }
        const next = { ...current?.values, ...change }
        if (!isSaving) {
          if (next.displayName === saved.displayName) next.displayName = undefined
          if (next.description === saved.description) next.description = undefined
          if (next.unredacted === saved.unredacted) next.unredacted = undefined
        }
        const overrides = filterUndefined(next)
        return Object.keys(overrides).length
          ? { credentialId: credential.id, values: overrides }
          : null
      })
    },
    [credential, isSaving]
  )

  const isSectionDirty = section?.isDirty ?? false
  const isDirty = isMetadataDirty || isSectionDirty
  const discard = useCallback(() => {
    if (isSaving) return
    setDraft(null)
    section?.discard()
  }, [isSaving, section])

  const save = useCallback(async () => {
    if (!credential || isSaving) return
    const submitted = draft
    if (isSectionDirty && !(await section?.save())) return
    if (!isAdmin || !isMetadataDirty) return

    try {
      await updateCredential.mutateAsync({
        credentialId: credential.id,
        ...(isDisplayNameDirty ? { displayName: values.displayName.trim() } : {}),
        ...(isDescriptionDirty ? { description: values.description.trim() || null } : {}),
        ...(isUnredactedDirty ? { unredacted: values.unredacted } : {}),
      })
      setDraft((current) => {
        if (current === submitted) return null
        if (!current || !submitted || current.credentialId !== submitted.credentialId)
          return current
        const next = { ...current.values }
        if (next.displayName === submitted.values.displayName) next.displayName = undefined
        if (next.description === submitted.values.description) next.description = undefined
        if (next.unredacted === submitted.values.unredacted) next.unredacted = undefined
        const overrides = filterUndefined(next)
        return Object.keys(overrides).length ? { ...current, values: overrides } : null
      })
    } catch (error) {
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
    values.displayName,
    values.description,
    values.unredacted,
    updateCredential.mutateAsync,
  ])

  return {
    displayNameDraft: values.displayName,
    setDisplayNameDraft: (displayName: string) => updateDraft({ displayName }),
    descriptionDraft: values.description,
    setDescriptionDraft: (description: string) => updateDraft({ description }),
    unredactedDraft: values.unredacted,
    setUnredactedDraft: (unredacted: boolean) => updateDraft({ unredacted }),
    isDirty,
    save,
    discard,
    isSaving,
  }
}
