'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createLogger } from '@sim/logger'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
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
import { cn } from '@/lib/core/utils/cn'

const logger = createLogger('EditKnowledgeBaseModal')

interface EditKnowledgeBaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  initialName: string
  initialDescription: string
  onSave: (id: string, name: string, description: string) => Promise<void>
}

const FormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters')
    .refine((value) => value.trim().length > 0, 'Name cannot be empty'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
})

type FormValues = z.infer<typeof FormSchema>

/**
 * Modal for editing knowledge base name and description
 */
export function EditKnowledgeBaseModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  initialName,
  initialDescription,
  onSave,
}: EditKnowledgeBaseModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: initialName,
      description: initialDescription,
    },
    mode: 'onSubmit',
  })

  const nameValue = watch('name')

  useEffect(() => {
    if (open) {
      setError(null)
      reset({
        name: initialName,
        description: initialDescription,
      })
    }
  }, [open, initialName, initialDescription, reset])

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true)
    setError(null)

    try {
      await onSave(knowledgeBaseId, data.name.trim(), data.description?.trim() || '')
      onOpenChange(false)
    } catch (err) {
      logger.error('Error updating knowledge base:', err)
      setError(err instanceof Error ? err.message : 'Failed to update knowledge base')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>Edit Knowledge Base</ModalHeader>

        <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody>
            <div className='space-y-3'>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='kb-name'>Name</Label>
                <Input
                  id='kb-name'
                  placeholder='Enter knowledge base name'
                  {...register('name')}
                  className={cn(errors.name && 'border-[var(--text-error)]')}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
                {errors.name && (
                  <p className='text-[var(--text-error)] text-caption'>{errors.name.message}</p>
                )}
              </div>

              <div className='flex flex-col gap-2'>
                <Label htmlFor='description'>Description</Label>
                <Textarea
                  id='description'
                  placeholder='Describe this knowledge base (optional)'
                  rows={4}
                  {...register('description')}
                  className={cn(errors.description && 'border-[var(--text-error)]')}
                />
                {errors.description && (
                  <p className='text-[var(--text-error)] text-caption'>
                    {errors.description.message}
                  </p>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <div className='flex w-full items-center justify-between gap-3'>
              {error ? (
                <p className='min-w-0 flex-1 truncate text-[var(--text-error)] text-caption leading-tight'>
                  {error}
                </p>
              ) : (
                <div />
              )}
              <div className='flex flex-shrink-0 gap-2'>
                <Button
                  variant='default'
                  onClick={() => onOpenChange(false)}
                  type='button'
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  variant='primary'
                  type='submit'
                  disabled={isSubmitting || !nameValue?.trim() || !isDirty}
                >
                  {isSubmitting ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
