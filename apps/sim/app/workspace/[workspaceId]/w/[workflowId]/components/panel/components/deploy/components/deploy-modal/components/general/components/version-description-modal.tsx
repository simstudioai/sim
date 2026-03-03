'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import {
  useGenerateVersionDescription,
  useUpdateDeploymentVersion,
} from '@/hooks/queries/deployments'

interface VersionDescriptionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  version: number
  versionName: string
  currentDescription: string | null | undefined
}

export function VersionDescriptionModal({
  open,
  onOpenChange,
  workflowId,
  version,
  versionName,
  currentDescription,
}: VersionDescriptionModalProps) {
  const t = useTranslations()
  const initialDescriptionRef = useRef(currentDescription || '')
  const [description, setDescription] = useState(initialDescriptionRef.current)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const updateMutation = useUpdateDeploymentVersion()
  const generateMutation = useGenerateVersionDescription()

  const hasChanges = description.trim() !== initialDescriptionRef.current.trim()
  const isGenerating = generateMutation.isPending

  const handleCloseAttempt = useCallback(() => {
    if (updateMutation.isPending || isGenerating) {
      return
    }
    if (hasChanges) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }, [hasChanges, updateMutation.isPending, isGenerating, onOpenChange])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescriptionRef.current)
    onOpenChange(false)
  }, [onOpenChange])

  const handleGenerateDescription = useCallback(() => {
    generateMutation.mutate({
      workflowId,
      version,
      onStreamChunk: (accumulated) => {
        setDescription(accumulated)
      },
    })
  }, [workflowId, version, generateMutation])

  const handleSave = useCallback(() => {
    if (!workflowId) return

    updateMutation.mutate(
      {
        workflowId,
        version,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
      }
    )
  }, [workflowId, version, description, updateMutation, onOpenChange])

  return (
    <>
      <Modal open={open} onOpenChange={(openState) => !openState && handleCloseAttempt()}>
        <ModalContent className='max-w-[480px]'>
          <ModalHeader>
            <span>{t('version_description_modal.labels.title')}</span>
          </ModalHeader>
          <ModalBody className='space-y-[10px]'>
            <div className='flex items-center justify-between'>
              <p className='text-[12px] text-[var(--text-secondary)]'>
                {currentDescription ? t('version_description_modal.messages.edit_description') : t('version_description_modal.messages.add_description')} {t('version_description_modal.messages.description_for')}{' '}
                <span className='font-medium text-[var(--text-primary)]'>{versionName}</span>
              </p>
              <Button
                variant='active'
                className='-my-1 h-5 px-2 py-0 text-[11px]'
                onClick={handleGenerateDescription}
                disabled={isGenerating || updateMutation.isPending}
              >
                {isGenerating ? t('version_description_modal.buttons.generating') : t('version_description_modal.buttons.generate')}
              </Button>
            </div>
            <Textarea
              placeholder={t('version_description_modal.placeholders.description')}
              className='min-h-[120px] resize-none'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              disabled={isGenerating}
            />
            <div className='flex items-center justify-between'>
              {(updateMutation.error || generateMutation.error) && (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {updateMutation.error?.message || generateMutation.error?.message}
                </p>
              )}
              {!updateMutation.error && !generateMutation.error && <div />}
              <p className='text-[11px] text-[var(--text-tertiary)]'>{description.length}/2000</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={handleCloseAttempt}
              disabled={updateMutation.isPending || isGenerating}
            >
              {t('version_description_modal.buttons.cancel')}
            </Button>
            <Button
              variant='tertiary'
              onClick={handleSave}
              disabled={updateMutation.isPending || isGenerating || !hasChanges}
            >
              {updateMutation.isPending ? t('version_description_modal.buttons.saving') : t('version_description_modal.buttons.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent className='max-w-[400px]'>
          <ModalHeader>
            <span>{t('version_description_modal.messages.unsaved_changes')}</span>
          </ModalHeader>
          <ModalBody>
            <p className='text-[14px] text-[var(--text-secondary)]'>
              {t('version_description_modal.messages.unsaved_changes_confirmation')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowUnsavedChangesAlert(false)}>
              {t('version_description_modal.buttons.keep_editing')}
            </Button>
            <Button variant='destructive' onClick={handleDiscardChanges}>
              {t('version_description_modal.buttons.discard_changes')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
