'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  ChipSwitch,
  chipFieldSurfaceClass,
  cn,
} from '@sim/emcn'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { SkillImport } from '@/app/workspace/[workspaceId]/skills/components/skill-import'
import {
  ACCESS_OPTIONS,
  SkillMembersSection,
} from '@/app/workspace/[workspaceId]/skills/components/skill-members'
import { parseSkillMarkdown } from '@/app/workspace/[workspaceId]/skills/components/utils'
import type { SkillDefinition } from '@/hooks/queries/skills'
import { useCreateSkill, useUpdateSkill } from '@/hooks/queries/skills'

const RichMarkdownField = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'
    ).then((m) => m.RichMarkdownField),
  {
    ssr: false,
    loading: () => <div className={cn('min-h-[200px]', chipFieldSurfaceClass)} />,
  }
)

interface SkillModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  onDelete?: (skillId: string) => void
  initialValues?: SkillDefinition
}

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

interface FieldErrors {
  name?: string
  description?: string
  content?: string
  general?: string
}

type TabValue = 'create' | 'import' | 'members'

const CREATE_TABS = [
  { value: 'create', label: 'Create' },
  { value: 'import', label: 'Import' },
] as const

const EDIT_TABS = [
  { value: 'create', label: 'Details' },
  { value: 'members', label: 'Members' },
] as const

export function SkillModal({
  open,
  onOpenChange,
  onSave,
  onDelete,
  initialValues,
}: SkillModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [workspaceSharedDraft, setWorkspaceSharedDraft] = useState(true)
  /**
   * Bumped to remount the seed-once rich Content editor whenever `content` is set programmatically — a
   * reset from a changed `initialValues` or a destructured SKILL.md paste — so the editor re-seeds (an
   * `initialValues` change for the same skill keeps the React key otherwise stable).
   */
  const [contentSeed, setContentSeed] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabValue>('create')
  const [prevOpen, setPrevOpen] = useState(false)
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues)

  // Reset by skill id, not object identity — a background refetch for the same open skill must not clobber an in-progress edit.
  if ((open && !prevOpen) || (open && initialValues?.id !== prevInitialValues?.id)) {
    setName(initialValues?.name ?? '')
    setDescription(initialValues?.description ?? '')
    setContent(initialValues?.content ?? '')
    // The sharing draft only drives the CREATE flow's Access switch; edits
    // read/write sharing live through the Members tab.
    setWorkspaceSharedDraft(true)
    setErrors({})
    setActiveTab('create')
    setContentSeed((seed) => seed + 1)
  }
  if (open !== prevOpen) setPrevOpen(open)
  if (initialValues !== prevInitialValues) setPrevInitialValues(initialValues)

  const hasChanges =
    !initialValues ||
    name !== initialValues.name ||
    description !== initialValues.description ||
    content !== initialValues.content

  const handleSave = async () => {
    const newErrors: FieldErrors = {}

    if (!name.trim()) {
      newErrors.name = 'Name is required'
    } else if (name.length > 64) {
      newErrors.name = 'Name must be 64 characters or less'
    } else if (!KEBAB_CASE_REGEX.test(name)) {
      newErrors.name = 'Name must be kebab-case (e.g. my-skill)'
    }

    if (!description.trim()) {
      newErrors.description = 'Description is required'
    }

    if (!content.trim()) {
      newErrors.content = 'Content is required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSaving(true)

    try {
      if (initialValues) {
        await updateSkill.mutateAsync({
          workspaceId,
          skillId: initialValues.id,
          updates: { name, description, content },
        })
      } else {
        await createSkill.mutateAsync({
          workspaceId,
          skill: { name, description, content, workspaceShared: workspaceSharedDraft },
        })
      }
      onSave()
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes('is unavailable')
          ? error.message
          : 'Failed to save skill. Please try again.'
      setErrors({ general: message })
    } finally {
      setSaving(false)
    }
  }

  const applyImportedSkill = (data: { name: string; description: string; content: string }) => {
    setName(data.name)
    setDescription(data.description)
    setContent(data.content)
    setErrors({})
    setContentSeed((seed) => seed + 1)
  }

  const handleImport = (data: { name: string; description: string; content: string }) => {
    applyImportedSkill(data)
    setActiveTab('create')
  }

  /**
   * Pasting a full SKILL.md destructures it into the fields. Gated on a real YAML `name:` key — a
   * stray `---` thematic break or a heading-only snippet pastes as ordinary content instead of
   * silently overwriting all three fields.
   */
  const handleContentPaste = (text: string): boolean => {
    const parsed = parseSkillMarkdown(text)
    if (!parsed.nameFromFrontmatter) return false
    applyImportedSkill(parsed)
    return true
  }

  const isEditing = !!initialValues
  const isBuiltin = !!initialValues?.readOnly
  /** New skills are created by the actor (skill admin); existing ones require the admin role. */
  const isSkillAdmin = !initialValues || initialValues.role === 'admin'
  const readOnly = isBuiltin || (isEditing && !isSkillAdmin)
  const showFooter = activeTab === 'create'

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={isEditing ? 'Edit Skill' : 'Add Skill'}
      size='lg'
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        {isEditing ? 'Edit Skill' : 'Add Skill'}
      </ChipModalHeader>

      <ChipModalBody>
        {!isBuiltin && (
          <ChipModalTabs
            tabs={isEditing ? EDIT_TABS : CREATE_TABS}
            value={activeTab}
            onChange={(value) => setActiveTab(value as TabValue)}
          />
        )}

        {activeTab === 'members' && initialValues && !isBuiltin ? (
          <SkillMembersSection
            skillId={initialValues.id}
            workspaceId={workspaceId}
            isAdmin={isSkillAdmin}
            workspaceShared={initialValues.workspaceShared}
          />
        ) : activeTab === 'create' || isEditing ? (
          <>
            <ChipModalField
              type='input'
              title='Name'
              value={name}
              onChange={(value) => {
                setName(value)
                if (errors.name || errors.general)
                  setErrors((prev) => ({ ...prev, name: undefined, general: undefined }))
              }}
              placeholder='my-skill-name'
              required
              error={errors.name}
              hint='Lowercase letters, numbers, and hyphens (e.g. my-skill)'
              disabled={readOnly || saving}
            />

            <ChipModalField
              type='input'
              title='Description'
              value={description}
              onChange={(value) => {
                setDescription(value)
                if (errors.description || errors.general)
                  setErrors((prev) => ({ ...prev, description: undefined, general: undefined }))
              }}
              placeholder='What this skill does and when to use it...'
              maxLength={1024}
              required
              error={errors.description}
              disabled={readOnly || saving}
            />

            <ChipModalField type='custom' title='Content' required error={errors.content}>
              <RichMarkdownField
                key={`${initialValues?.id ?? 'new'}:${contentSeed}`}
                value={content}
                onChange={(value) => {
                  setContent(value)
                  if (errors.content || errors.general)
                    setErrors((prev) => ({ ...prev, content: undefined, general: undefined }))
                }}
                placeholder='Skill instructions in markdown...'
                minHeight={200}
                disabled={readOnly || saving}
                error={!!errors.content}
                workspaceId={workspaceId}
                onPasteText={handleContentPaste}
              />
            </ChipModalField>

            {!isEditing && (
              <ChipModalField
                type='custom'
                title='Access'
                hint={
                  workspaceSharedDraft
                    ? 'Everyone in the workspace can use this skill.'
                    : 'Only you and workspace admins can use this skill until you add members.'
                }
              >
                <ChipSwitch
                  aria-label='Skill access'
                  options={ACCESS_OPTIONS}
                  value={workspaceSharedDraft ? 'workspace' : 'restricted'}
                  onChange={(value) => setWorkspaceSharedDraft(value === 'workspace')}
                />
              </ChipModalField>
            )}

            <ChipModalError>{errors.general}</ChipModalError>
          </>
        ) : (
          <SkillImport onImport={handleImport} />
        )}
      </ChipModalBody>

      {showFooter && (
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={isBuiltin}
          secondaryActions={
            isEditing && onDelete
              ? [
                  {
                    label: 'Delete',
                    onClick: () => onDelete(initialValues.id),
                    variant: 'destructive',
                    disabled: readOnly,
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: saving ? 'Saving...' : isEditing ? 'Update' : 'Create',
            onClick: handleSave,
            disabled: readOnly || saving || !hasChanges,
          }}
        />
      )}
    </ChipModal>
  )
}
