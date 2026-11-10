'use client'

import { useState } from 'react'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type SkillDraft,
  type SkillErrors,
  SkillFields,
  validateSkillDraft,
} from '@/app/(product)/_components/skill-fields/skill-fields'
import {
  isSkillNameConflictError,
  readSkillFile,
  SKILL_IMPORT_ACCEPT,
  SKILL_NAME_HINT,
  type SkillDefinition,
  useCreateSkill,
  useUpdateSkill,
} from '@/platform/lib/data/workflow-editor/mcp'

interface SkillModalProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  /** The skill to edit; absent to create one. */
  initialValues?: SkillDefinition
}

const EMPTY_DRAFT: SkillDraft = { name: '', description: '', content: '' }

/**
 * Creates a workspace skill, or edits one the viewer may change, from a block's skill list. A new
 * skill can start from an imported SKILL.md or ZIP, and pasting a whole SKILL.md into its
 * instructions fills every field from its frontmatter.
 */
export function SkillModal({
  workspaceId,
  open,
  onOpenChange,
  onSave,
  initialValues,
}: SkillModalProps) {
  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()

  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [errors, setErrors] = useState<SkillErrors>({})
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | undefined>()
  const [prevOpen, setPrevOpen] = useState(false)
  const [prevSkillId, setPrevSkillId] = useState(initialValues?.id)

  // Reset by skill id, not object identity: a background refetch of the open skill keeps the draft.
  if ((open && !prevOpen) || (open && initialValues?.id !== prevSkillId)) {
    setDraft(
      initialValues
        ? {
            name: initialValues.name,
            description: initialValues.description,
            content: initialValues.content,
          }
        : EMPTY_DRAFT
    )
    setErrors({})
    setImportError(undefined)
  }
  if (open !== prevOpen) setPrevOpen(open)
  if (initialValues?.id !== prevSkillId) setPrevSkillId(initialValues?.id)

  const isEditing = !!initialValues
  // New skills belong to their creator; an existing one needs editor access, and built-ins never change.
  const readOnly = !!initialValues && (!!initialValues.readOnly || !initialValues.canEdit)
  const saving = createSkill.isPending || updateSkill.isPending
  const hasChanges =
    !initialValues ||
    draft.name !== initialValues.name ||
    draft.description !== initialValues.description ||
    draft.content !== initialValues.content

  const edit = (next: SkillDraft, changed: readonly (keyof SkillDraft)[]) => {
    setDraft(next)
    setErrors((current) => {
      const remaining = { ...current }
      for (const field of changed) delete remaining[field]
      return remaining
    })
  }

  const handleImportFile = async (file: File) => {
    setImporting(true)
    setImportError(undefined)
    try {
      const { name, description, content } = await readSkillFile(file)
      setDraft({ name, description, content })
      setErrors({})
    } catch (error) {
      setImportError(getErrorMessage(error, 'Failed to process file'))
    } finally {
      setImporting(false)
    }
  }

  const handleSave = async (): Promise<false | undefined> => {
    const nextErrors = validateSkillDraft(draft)
    const { name, description, content } = draft
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return false
    }

    try {
      if (initialValues) {
        await updateSkill.mutateAsync({
          workspaceId,
          skillId: initialValues.id,
          updates: { name, description, content },
        })
      } else {
        await createSkill.mutateAsync({ workspaceId, skill: { name, description, content } })
      }
    } catch (error) {
      if (isSkillNameConflictError(error)) {
        setErrors({ name: getErrorMessage(error, 'This skill name is already taken.') })
        return false
      }
      throw new Error('Failed to save skill. Please try again.')
    }
    onSave()
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? 'Edit skill' : 'Add skill'}
      confirmLabel={saving ? 'Saving…' : isEditing ? 'Update' : 'Create'}
      confirmDisabled={readOnly || saving || !hasChanges}
      onConfirm={handleSave}
    >
      <SkillFields
        draft={draft}
        errors={errors}
        onEdit={edit}
        viewOnly={readOnly}
        disabled={saving}
        nameHint={SKILL_NAME_HINT}
      />
      {!isEditing && (
        <FileField
          label='Import from file'
          optional
          accept={SKILL_IMPORT_ACCEPT}
          prompt={importing ? 'Importing…' : 'Choose a SKILL.md or ZIP, or drag it here'}
          hint='.md file with YAML frontmatter, or .zip containing a SKILL.md'
          error={importError}
          disabled={importing || saving}
          onFileChange={(file) => void handleImportFile(file)}
        />
      )}
    </Modal>
  )
}
