'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  chipFieldSurfaceClass,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { SkillImport } from '@/app/workspace/[workspaceId]/skills/components/skill-import'
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

type TabValue = 'create' | 'import'

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
  // Bumped to remount the rich Content editor when content is set programmatically (a pasted
  // SKILL.md is destructured into the fields) — the editor otherwise only seeds on mount.
  const [contentSeed, setContentSeed] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabValue>('create')
  const [prevOpen, setPrevOpen] = useState(false)
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues)

  if ((open && !prevOpen) || (open && initialValues !== prevInitialValues)) {
    setName(initialValues?.name ?? '')
    setDescription(initialValues?.description ?? '')
    setContent(initialValues?.content ?? '')
    setErrors({})
    setActiveTab('create')
  }
  if (open !== prevOpen) setPrevOpen(open)
  if (initialValues !== prevInitialValues) setPrevInitialValues(initialValues)

  const hasChanges = useMemo(() => {
    if (!initialValues) return true
    return (
      name !== initialValues.name ||
      description !== initialValues.description ||
      content !== initialValues.content
    )
  }, [name, description, content, initialValues])

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
          skill: { name, description, content },
        })
      }
      onSave()
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes('already exists')
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

  /** Pasting a full SKILL.md (YAML frontmatter) into Content destructures it into the fields. */
  const handleContentPaste = (text: string): boolean => {
    if (!text.trimStart().startsWith('---')) return false
    const parsed = parseSkillMarkdown(text)
    if (!parsed.name) return false
    applyImportedSkill(parsed)
    return true
  }

  const isEditing = !!initialValues
  const readOnly = !!initialValues?.readOnly
  const showFooter = activeTab === 'create' || isEditing

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
        {/* Tab switcher — only on create flow */}
        {!isEditing && (
          <ChipModalTabs
            tabs={[
              { value: 'create', label: 'Create' },
              { value: 'import', label: 'Import' },
            ]}
            value={activeTab}
            onChange={(value) => setActiveTab(value as TabValue)}
          />
        )}

        {activeTab === 'create' || isEditing ? (
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

            <ChipModalError>{errors.general}</ChipModalError>
          </>
        ) : (
          <SkillImport onImport={handleImport} />
        )}
      </ChipModalBody>

      {showFooter && (
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={readOnly}
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
