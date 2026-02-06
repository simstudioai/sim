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
  initialValues?: SkillDefinition
}

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function SkillModal({ open, onOpenChange, onSave, initialValues }: SkillModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [formError, setFormError] = useState('')
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
      setFormError('')
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
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }
    if (name.length > 64) {
      setFormError('Name must be 64 characters or less')
      return
    }
    if (!KEBAB_CASE_REGEX.test(name)) {
      setFormError('Name must be kebab-case (e.g. my-skill)')
      return
    }
    if (!description.trim()) {
      setFormError('Description is required')
      return
    }
    if (!content.trim()) {
      setFormError('Content is required')
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
    } catch {
      // Error is handled by React Query
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='lg'>
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
                  if (formError) setFormError('')
                }}
              />
              {formError && (
                <span className='text-[11px] text-[var(--text-error)]'>{formError}</span>
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
                  if (formError) setFormError('')
                }}
                maxLength={1024}
              />
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
                  if (formError) setFormError('')
                }}
                className='min-h-[200px] resize-y font-mono text-[13px]'
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant='tertiary' onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? 'Saving...' : initialValues ? 'Update' : 'Create'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
