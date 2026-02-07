'use client'

import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
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

interface FieldErrors {
  name?: string
  description?: string
  content?: string
  general?: string
}

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

  useEffect(() => {
    if (open) {
      if (initialValues) {
        setName(initialValues.name)
        setDescription(initialValues.description)
        setContent(initialValues.content)
      } else {
        setName('')
        setDescription('')
        setContent('')
      }
      setErrors({})
    }
  }, [open, initialValues])

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

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='xl'>
        <ModalHeader>{initialValues ? 'Edit Skill' : 'Create Skill'}</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-[16px]'>
            <div className='flex flex-col gap-[4px]'>
              <Label htmlFor='skill-name' className='font-medium text-[13px]'>
                Name
              </Label>
              <Input
                id='skill-name'
                placeholder='my-skill-name'
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (errors.name || errors.general)
                    setErrors((prev) => ({ ...prev, name: undefined, general: undefined }))
                }}
              />
              {errors.name ? (
                <p className='text-[12px] text-[var(--text-error)]'>{errors.name}</p>
              ) : (
                <span className='text-[11px] text-[var(--text-muted)]'>
                  Lowercase letters, numbers, and hyphens (e.g. my-skill)
                </span>
              )}
            </div>

            <div className='flex flex-col gap-[4px]'>
              <Label htmlFor='skill-description' className='font-medium text-[13px]'>
                Description
              </Label>
              <Input
                id='skill-description'
                placeholder='What this skill does and when to use it...'
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  if (errors.description || errors.general)
                    setErrors((prev) => ({ ...prev, description: undefined, general: undefined }))
                }}
                maxLength={1024}
              />
              {errors.description && (
                <p className='text-[12px] text-[var(--text-error)]'>{errors.description}</p>
              )}
            </div>

            <div className='flex flex-col gap-[4px]'>
              <Label htmlFor='skill-content' className='font-medium text-[13px]'>
                Content
              </Label>
              <Textarea
                id='skill-content'
                placeholder='Skill instructions in markdown...'
                value={content}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  setContent(e.target.value)
                  if (errors.content || errors.general)
                    setErrors((prev) => ({ ...prev, content: undefined, general: undefined }))
                }}
                className='min-h-[200px] resize-y font-mono text-[13px]'
              />
              {errors.content && (
                <p className='text-[12px] text-[var(--text-error)]'>{errors.content}</p>
              )}
            </div>

            {errors.general && (
              <p className='text-[12px] text-[var(--text-error)]'>{errors.general}</p>
            )}
          </div>
        </ModalBody>
        <ModalFooter className='items-center justify-between'>
          {initialValues && onDelete ? (
            <Button variant='destructive' onClick={() => onDelete(initialValues.id)}>
              Delete
            </Button>
          ) : (
            <div />
          )}
          <div className='flex gap-2'>
            <Button variant='default' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant='tertiary' onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? 'Saving...' : initialValues ? 'Update' : 'Create'}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
