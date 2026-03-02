'use client'

import type { ChangeEvent } from 'react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues)

  if ((open && !prevOpen) || (open && initialValues !== prevInitialValues)) {
    setName(initialValues?.name ?? '')
    setDescription(initialValues?.description ?? '')
    setContent(initialValues?.content ?? '')
    setErrors({})
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
      newErrors.name = t('settings.skill_modal.errors.name_required')
    } else if (name.length > 64) {
      newErrors.name = t('settings.skill_modal.errors.name_too_long')
    } else if (!KEBAB_CASE_REGEX.test(name)) {
      newErrors.name = t('settings.skill_modal.errors.name_format')
    }

    if (!description.trim()) {
      newErrors.description = t('settings.skill_modal.errors.description_required')
    }

    if (!content.trim()) {
      newErrors.content = t('settings.skill_modal.errors.content_required')
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
          : t('settings.skill_modal.errors.save_failed')
      setErrors({ general: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='xl'>
        <ModalHeader>
          {initialValues
            ? t('settings.skill_modal.title_edit')
            : t('settings.skill_modal.title_create')}
        </ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-[16px]'>
            <div className='flex flex-col gap-[4px]'>
              <Label htmlFor='skill-name' className='font-medium text-[13px]'>
                {t('settings.skill_modal.labels.name')}
              </Label>
              <Input
                id='skill-name'
                placeholder={t('settings.skill_modal.placeholders.name')}
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
                  {t('settings.skill_modal.hints.name_format')}
                </span>
              )}
            </div>

            <div className='flex flex-col gap-[4px]'>
              <Label htmlFor='skill-description' className='font-medium text-[13px]'>
                {t('settings.skill_modal.labels.description')}
              </Label>
              <Input
                id='skill-description'
                placeholder={t('settings.skill_modal.placeholders.description')}
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
                {t('settings.skill_modal.labels.content')}
              </Label>
              <Textarea
                id='skill-content'
                placeholder={t('settings.skill_modal.placeholders.content')}
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
              {t('settings.skill_modal.buttons.delete')}
            </Button>
          ) : (
            <div />
          )}
          <div className='flex gap-2'>
            <Button variant='default' onClick={() => onOpenChange(false)}>
              {t('settings.skill_modal.buttons.cancel')}
            </Button>
            <Button variant='tertiary' onClick={handleSave} disabled={saving || !hasChanges}>
              {saving
                ? t('settings.skill_modal.buttons.saving')
                : initialValues
                  ? t('settings.skill_modal.buttons.update')
                  : t('settings.skill_modal.buttons.create')}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
