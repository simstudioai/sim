'use client'

import { type ClipboardEvent, useState } from 'react'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { getErrorMessage } from '@sim/utils/errors'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/skill-input/skill-input.module.css'
import {
  isSkillNameConflictError,
  type ParsedSkill,
  parseSkillMarkdown,
  readSkillFile,
  SKILL_CONTENT_PLACEHOLDER,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_DESCRIPTION_PLACEHOLDER,
  SKILL_IMPORT_ACCEPT,
  SKILL_NAME_HINT,
  SKILL_NAME_PLACEHOLDER,
  type SkillDefinition,
  useCreateSkill,
  useUpdateSkill,
  validateSkillName,
} from '@/platform/lib/data/workflow-editor/mcp'

interface SkillModalProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  /** The skill to edit; absent to create one. */
  initialValues?: SkillDefinition
}

interface FieldErrors {
  name?: string
  description?: string
  content?: string
}

/**
 * Creates a workspace skill, or edits one the viewer may change, from a block's skill list. A new
 * skill can start from an imported SKILL.md or ZIP, and pasting a whole SKILL.md into Content
 * fills every field from its frontmatter.
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

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | undefined>()
  const [prevOpen, setPrevOpen] = useState(false)
  const [prevSkillId, setPrevSkillId] = useState(initialValues?.id)

  // Reset by skill id, not object identity: a background refetch of the open skill keeps the draft.
  if ((open && !prevOpen) || (open && initialValues?.id !== prevSkillId)) {
    setName(initialValues?.name ?? '')
    setDescription(initialValues?.description ?? '')
    setContent(initialValues?.content ?? '')
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
    name !== initialValues.name ||
    description !== initialValues.description ||
    content !== initialValues.content

  const applyImportedSkill = (data: ParsedSkill) => {
    setName(data.name)
    setDescription(data.description)
    setContent(data.content)
    setErrors({})
  }

  const handleImportFile = async (file: File) => {
    setImporting(true)
    setImportError(undefined)
    try {
      applyImportedSkill(await readSkillFile(file))
    } catch (error) {
      setImportError(getErrorMessage(error, 'Failed to process file'))
    } finally {
      setImporting(false)
    }
  }

  // Only a real frontmatter `name:` destructures a paste; anything else pastes as plain content.
  const handleContentPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (readOnly || saving || !(event.target instanceof HTMLTextAreaElement)) return
    const parsed = parseSkillMarkdown(event.clipboardData.getData('text/plain'))
    if (!parsed.nameFromFrontmatter) return
    event.preventDefault()
    applyImportedSkill(parsed)
  }

  const handleSave = async (): Promise<false | undefined> => {
    const nextErrors: FieldErrors = {}
    const nameError = validateSkillName(name)
    if (nameError) nextErrors.name = nameError
    if (!description.trim()) nextErrors.description = 'Description is required'
    if (!content.trim()) nextErrors.content = 'Content is required'
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
      <TextField
        label='Name'
        value={name}
        onChange={(next) => {
          setName(next)
          if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
        }}
        placeholder={SKILL_NAME_PLACEHOLDER}
        hint={SKILL_NAME_HINT}
        error={errors.name}
        readOnly={readOnly}
        disabled={saving}
        autoComplete='off'
      />
      <TextField
        label='Description'
        value={description}
        onChange={(next) => {
          setDescription(next)
          if (errors.description) setErrors((prev) => ({ ...prev, description: undefined }))
        }}
        placeholder={SKILL_DESCRIPTION_PLACEHOLDER}
        maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
        error={errors.description}
        readOnly={readOnly}
        disabled={saving}
        autoComplete='off'
      />
      <div className={styles.contentField} onPaste={handleContentPaste}>
        <TextAreaField
          label='Content'
          value={content}
          onChange={(next) => {
            setContent(next)
            if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }))
          }}
          placeholder={SKILL_CONTENT_PLACEHOLDER}
          defaultSize='large'
          spellCheck={false}
          error={errors.content}
          readOnly={readOnly}
          disabled={saving}
        />
      </div>
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
