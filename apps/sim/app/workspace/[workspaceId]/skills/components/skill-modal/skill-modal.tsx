'use client'

import type { ChangeEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { SkillImport } from '@/app/workspace/[workspaceId]/skills/components/skill-import'
import type { SkillDefinition } from '@/hooks/queries/skills'
import { useCreateSkill, useUpdateSkill } from '@/hooks/queries/skills'

interface SkillModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  onDelete?: (skillId: string) => void
  initialValues?: SkillDefinition
}

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Matches ChipModalField's internal input/textarea chrome. */
const TEXT_CHROME =
  'w-full rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-medium font-sans text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--surface-4)]'

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

  const handleImport = useCallback(
    (data: { name: string; description: string; content: string }) => {
      setName(data.name)
      setDescription(data.description)
      setContent(data.content)
      setErrors({})
      setActiveTab('create')
    },
    []
  )

  const isEditing = !!initialValues
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
          <div className='flex gap-1 px-2'>
            <Chip
              variant={activeTab === 'create' ? 'filled' : 'ghost'}
              flush
              onClick={() => setActiveTab('create')}
            >
              Create
            </Chip>
            <Chip
              variant={activeTab === 'import' ? 'filled' : 'ghost'}
              flush
              onClick={() => setActiveTab('import')}
            >
              Import
            </Chip>
          </div>
        )}

        {activeTab === 'create' || isEditing ? (
          <>
            {/* Name — custom to support helper text below input */}
            <ChipModalField type='custom' title='Name' required>
              <div className='flex flex-col gap-[6px]'>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (errors.name || errors.general)
                      setErrors((prev) => ({ ...prev, name: undefined, general: undefined }))
                  }}
                  placeholder='my-skill-name'
                  className={cn(TEXT_CHROME, 'h-[30px]')}
                  aria-invalid={!!errors.name}
                />
                {errors.name ? (
                  <p className='text-[12px] text-[var(--text-error)]'>{errors.name}</p>
                ) : (
                  <p className='text-[11px] text-[var(--text-muted)]'>
                    Lowercase letters, numbers, and hyphens (e.g. my-skill)
                  </p>
                )}
              </div>
            </ChipModalField>

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

            {/* Content — custom to support monospace + resizable textarea */}
            <ChipModalField type='custom' title='Content' required>
              <div className='flex flex-col gap-[6px]'>
                <textarea
                  value={content}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                    setContent(e.target.value)
                    if (errors.content || errors.general)
                      setErrors((prev) => ({ ...prev, content: undefined, general: undefined }))
                  }}
                  placeholder='Skill instructions in markdown...'
                  className={cn(TEXT_CHROME, 'min-h-[200px] resize-y py-2')}
                  aria-invalid={!!errors.content}
                />
                {errors.content && (
                  <p className='text-[12px] text-[var(--text-error)]'>{errors.content}</p>
                )}
              </div>
            </ChipModalField>

            <ChipModalError>{errors.general}</ChipModalError>
          </>
        ) : (
          <SkillImport onImport={handleImport} />
        )}
      </ChipModalBody>

      {showFooter && (
        <ChipModalFooter className={isEditing && onDelete ? 'justify-between' : undefined}>
          {isEditing && onDelete && (
            <Chip variant='destructive' flush onClick={() => onDelete(initialValues.id)}>
              Delete
            </Chip>
          )}
          <div className='flex gap-2'>
            <Chip variant='filled' flush onClick={() => onOpenChange(false)}>
              Cancel
            </Chip>
            <Chip variant='primary' flush onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Chip>
          </div>
        </ChipModalFooter>
      )}
    </ChipModal>
  )
}
