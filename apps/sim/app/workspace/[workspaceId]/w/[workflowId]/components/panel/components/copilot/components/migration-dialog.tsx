'use client'

import { useState } from 'react'
import { AlertCircle, FileUp, Upload } from 'lucide-react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'

interface MigrationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitToChat: (jsonContent: string) => void
}

export function MigrationDialog({ open, onOpenChange, onSubmitToChat }: MigrationDialogProps) {
  const [workflowJson, setWorkflowJson] = useState('')
  const [validationError, setValidationError] = useState<string>('')

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setWorkflowJson(content)
      setValidationError('')
      
      // Validate it's valid JSON
      try {
        JSON.parse(content)
      } catch (error) {
        setValidationError('Invalid JSON format')
      }
    }
    reader.onerror = () => {
      setValidationError('Failed to read file. Please try again.')
    }
    reader.readAsText(file)
  }

  const handleSubmit = async () => {
    if (!workflowJson.trim()) {
      setValidationError('Please upload or paste a workflow JSON')
      return
    }

    // Validate JSON
    try {
      const parsed = JSON.parse(workflowJson)
      
      // Basic n8n workflow validation
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        setValidationError('Invalid n8n workflow: missing "nodes" array')
        return
      }
      
      if (parsed.nodes.length === 0) {
        setValidationError('Invalid n8n workflow: must contain at least one node')
        return
      }

      // Use the simplified formatter
      const { formatMigrationRequest } = await import('@/lib/migration')
      const message = await formatMigrationRequest(workflowJson)
      
      onSubmitToChat(message)
      
      // Reset and close
      setWorkflowJson('')
      setValidationError('')
      onOpenChange(false)
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Invalid JSON format')
    }
  }

  const handleClose = () => {
    setWorkflowJson('')
    setValidationError('')
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className='max-w-3xl max-h-[90vh] overflow-hidden flex flex-col'>
        <ModalHeader>
          <div className='flex items-center gap-2'>
            <span>Migrate from n8n</span>
            <span className='text-xs bg-[var(--surface-3)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full font-medium'>
              BETA
            </span>
          </div>
        </ModalHeader>

        <ModalBody className='flex-1 overflow-y-auto'>
          <div className='space-y-4'>
            {/* Info Banner */}
            <div className='rounded-md bg-[var(--surface-2)] border border-[var(--border)] p-3'>
              <div className='flex items-start gap-2'>
                <Upload className='h-4 w-4 text-[var(--text-secondary)] mt-0.5 flex-shrink-0' />
                <div className='flex-1 text-sm text-[var(--text-primary)]'>
                  <p className='font-medium mb-1'>Upload n8n Workflow</p>
                  <p className='text-xs text-[var(--text-secondary)]'>
                    Upload or paste your n8n workflow JSON. The workflow will be submitted to Copilot for intelligent conversion to Sim blocks.
                  </p>
                </div>
              </div>
            </div>

            {/* Upload Section */}
            <div>
              <label className='block text-sm font-medium text-[var(--text-primary)] mb-2'>
                Upload n8n Workflow JSON
              </label>
              <div className='flex gap-2'>
                <label className='flex-1 flex items-center justify-center h-32 px-4 border-2 border-[var(--border)] border-dashed rounded-lg cursor-pointer hover:border-[var(--border-hover)] transition-colors bg-[var(--surface-1)]'>
                  <div className='flex flex-col items-center'>
                    <FileUp className='w-8 h-8 text-[var(--text-tertiary)] mb-2' />
                    <span className='text-sm text-[var(--text-secondary)]'>
                      Click to upload or drag & drop
                    </span>
                    <span className='text-xs text-[var(--text-tertiary)] mt-1'>JSON files only</span>
                  </div>
                  <input
                    type='file'
                    className='hidden'
                    accept='.json,application/json'
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            </div>

            {/* JSON Input */}
            <div>
              <label className='block text-sm font-medium text-[var(--text-primary)] mb-2'>
                Or Paste n8n Workflow JSON
              </label>
              <textarea
                className='w-full h-64 px-3 py-2 text-sm font-mono border border-[var(--border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--accent)] bg-[var(--surface-1)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]'
                placeholder='Paste your n8n workflow JSON here...'
                value={workflowJson}
                onChange={(e) => {
                  setWorkflowJson(e.target.value)
                  setValidationError('')
                }}
              />
            </div>

            {/* Validation Error */}
            {validationError && (
              <div className='rounded-md bg-red-50 border border-red-200 p-3'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='h-4 w-4 text-red-600 mt-0.5 flex-shrink-0' />
                  <div className='flex-1'>
                    <p className='text-sm font-medium text-red-900'>Validation Error</p>
                    <p className='text-sm text-red-700 mt-1'>{validationError}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant='ghost' onClick={handleClose}>
            Cancel
          </Button>

          <Button
            onClick={handleSubmit}
            disabled={!workflowJson.trim()}
            variant='tertiary'
          >
            <Upload className='mr-2 h-4 w-4' />
            Submit to Copilot
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
