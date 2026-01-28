'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
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
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

type NormalizedField = InputFormatField & { name: string }

interface ApiInfoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
}

export function ApiInfoModal({ open, onOpenChange, workflowId }: ApiInfoModalProps) {
  const blocks = useWorkflowStore((state) => state.blocks)
  const setValue = useSubBlockStore((state) => state.setValue)
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? (state.workflowValues[workflowId] ?? {}) : {}
  )

  const workflowMetadata = useWorkflowRegistry((state) =>
    workflowId ? state.workflows[workflowId] : undefined
  )
  const updateWorkflow = useWorkflowRegistry((state) => state.updateWorkflow)

  const [description, setDescription] = useState('')
  const [paramDescriptions, setParamDescriptions] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)

  const initialDescriptionRef = useRef('')
  const initialParamDescriptionsRef = useRef<Record<string, string>>({})

  const starterBlockId = useMemo(() => {
    for (const [blockId, block] of Object.entries(blocks)) {
      if (!block || typeof block !== 'object') continue
      const blockType = (block as { type?: string }).type
      if (blockType && isInputDefinitionTrigger(blockType)) {
        return blockId
      }
    }
    return null
  }, [blocks])

  const inputFormat = useMemo((): NormalizedField[] => {
    if (!starterBlockId) return []

    const storeValue = subBlockValues[starterBlockId]?.inputFormat
    const normalized = normalizeInputFormatValue(storeValue) as NormalizedField[]
    if (normalized.length > 0) return normalized

    const startBlock = blocks[starterBlockId]
    const blockValue = startBlock?.subBlocks?.inputFormat?.value
    return normalizeInputFormatValue(blockValue) as NormalizedField[]
  }, [starterBlockId, subBlockValues, blocks])

  useEffect(() => {
    if (open) {
      const normalizedDesc = workflowMetadata?.description?.toLowerCase().trim()
      const isDefaultDescription =
        !workflowMetadata?.description ||
        workflowMetadata.description === workflowMetadata.name ||
        normalizedDesc === 'new workflow' ||
        normalizedDesc === 'your first workflow - start building here!'

      const initialDescription = isDefaultDescription ? '' : workflowMetadata?.description || ''
      setDescription(initialDescription)
      initialDescriptionRef.current = initialDescription

      const descriptions: Record<string, string> = {}
      for (const field of inputFormat) {
        if (field.description) {
          descriptions[field.name] = field.description
        }
      }
      setParamDescriptions(descriptions)
      initialParamDescriptionsRef.current = { ...descriptions }
    }
  }, [open, workflowMetadata, inputFormat])

  const hasChanges = useMemo(() => {
    if (description.trim() !== initialDescriptionRef.current.trim()) return true

    for (const field of inputFormat) {
      const currentValue = (paramDescriptions[field.name] || '').trim()
      const initialValue = (initialParamDescriptionsRef.current[field.name] || '').trim()
      if (currentValue !== initialValue) return true
    }

    return false
  }, [description, paramDescriptions, inputFormat])

  const handleParamDescriptionChange = (fieldName: string, value: string) => {
    setParamDescriptions((prev) => ({
      ...prev,
      [fieldName]: value,
    }))
  }

  const handleCloseAttempt = useCallback(() => {
    if (hasChanges && !isSaving) {
      setShowUnsavedChangesAlert(true)
    } else {
      onOpenChange(false)
    }
  }, [hasChanges, isSaving, onOpenChange])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setDescription(initialDescriptionRef.current)
    setParamDescriptions({ ...initialParamDescriptionsRef.current })
    onOpenChange(false)
  }, [onOpenChange])

  const handleSave = useCallback(async () => {
    if (!workflowId) return

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId !== workflowId) {
      return
    }

    setIsSaving(true)
    try {
      if (description.trim() !== (workflowMetadata?.description || '')) {
        updateWorkflow(workflowId, { description: description.trim() || 'New workflow' })
      }

      if (starterBlockId) {
        const updatedValue = inputFormat.map((field) => ({
          ...field,
          description: paramDescriptions[field.name]?.trim() || undefined,
        }))
        setValue(starterBlockId, 'inputFormat', updatedValue)
      }

      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }, [
    workflowId,
    description,
    workflowMetadata,
    updateWorkflow,
    starterBlockId,
    inputFormat,
    paramDescriptions,
    setValue,
    onOpenChange,
  ])

  return (
    <>
      <Modal open={open} onOpenChange={(openState) => !openState && handleCloseAttempt()}>
        <ModalContent className='max-w-[480px]'>
          <ModalHeader>
            <span>Edit API Info</span>
          </ModalHeader>
          <ModalBody className='space-y-[12px]'>
            <div>
              <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                Description
              </Label>
              <Textarea
                placeholder='Describe what this workflow API does...'
                className='min-h-[80px] resize-none'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {inputFormat.length > 0 && (
              <div>
                <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
                  Parameters ({inputFormat.length})
                </Label>
                <div className='flex flex-col gap-[8px]'>
                  {inputFormat.map((field) => (
                    <div
                      key={field.name}
                      className='overflow-hidden rounded-[4px] border border-[var(--border-1)]'
                    >
                      <div className='flex items-center justify-between bg-[var(--surface-4)] px-[10px] py-[5px]'>
                        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                          <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
                            {field.name}
                          </span>
                          <Badge variant='type' size='sm'>
                            {field.type || 'string'}
                          </Badge>
                        </div>
                      </div>
                      <div className='border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
                        <div className='flex flex-col gap-[6px]'>
                          <Label className='text-[13px]'>Description</Label>
                          <Input
                            value={paramDescriptions[field.name] || ''}
                            onChange={(e) =>
                              handleParamDescriptionChange(field.name, e.target.value)
                            }
                            placeholder={`Enter description for ${field.name}`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCloseAttempt} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant='tertiary' onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent className='max-w-[400px]'>
          <ModalHeader>
            <span>Unsaved Changes</span>
          </ModalHeader>
          <ModalBody>
            <p className='text-[14px] text-[var(--text-secondary)]'>
              You have unsaved changes. Are you sure you want to discard them?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowUnsavedChangesAlert(false)}>
              Keep Editing
            </Button>
            <Button variant='destructive' onClick={handleDiscardChanges}>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
