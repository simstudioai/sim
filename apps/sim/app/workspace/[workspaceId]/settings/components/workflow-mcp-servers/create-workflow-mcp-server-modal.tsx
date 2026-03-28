'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Combobox,
  type ComboboxOption,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { FormField } from '@/app/workspace/[workspaceId]/settings/components/mcp/components'
import { useCreateWorkflowMcpServer } from '@/hooks/queries/workflow-mcp-servers'

const logger = createLogger('CreateWorkflowMcpServerModal')

const INITIAL_FORM_DATA: { name: string; description: string; isPublic: boolean } = {
  name: '',
  description: '',
  isPublic: false,
}

interface CreateWorkflowMcpServerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workflowOptions?: ComboboxOption[]
  isLoadingWorkflows?: boolean
}

export function CreateWorkflowMcpServerModal({
  open,
  onOpenChange,
  workspaceId,
  workflowOptions,
  isLoadingWorkflows = false,
}: CreateWorkflowMcpServerModalProps) {
  const createServerMutation = useCreateWorkflowMcpServer()

  const [formData, setFormData] = useState({ ...INITIAL_FORM_DATA })
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([])

  const isFormValid = formData.name.trim().length > 0

  useEffect(() => {
    if (open) {
      setFormData({ ...INITIAL_FORM_DATA })
      setSelectedWorkflowIds([])
    }
  }, [open])

  const handleCreateServer = useCallback(async () => {
    if (!formData.name.trim()) return

    try {
      await createServerMutation.mutateAsync({
        workspaceId,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        isPublic: formData.isPublic,
        workflowIds: selectedWorkflowIds.length > 0 ? selectedWorkflowIds : undefined,
      })
      onOpenChange(false)
    } catch (err) {
      logger.error('Failed to create server:', err)
    }
  }, [formData, selectedWorkflowIds, workspaceId, onOpenChange])

  const showWorkflows = workflowOptions !== undefined

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>Add New MCP Server</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-3'>
            <FormField label='Server Name'>
              <EmcnInput
                placeholder='e.g., My MCP Server'
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className='h-9'
              />
            </FormField>

            <FormField label='Description'>
              <Textarea
                placeholder='Describe what this MCP server does (optional)'
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className='min-h-[60px] resize-none'
              />
            </FormField>

            {showWorkflows && (
              <FormField label='Workflows'>
                <Combobox
                  options={workflowOptions ?? []}
                  multiSelect
                  multiSelectValues={selectedWorkflowIds}
                  onMultiSelectChange={setSelectedWorkflowIds}
                  placeholder='Select workflows...'
                  searchable
                  searchPlaceholder='Search workflows...'
                  isLoading={isLoadingWorkflows}
                  disabled={createServerMutation.isPending}
                  emptyMessage='No deployed workflows available'
                  overlayContent={
                    selectedWorkflowIds.length > 0 ? (
                      <span className='text-[var(--text-primary)]'>
                        {selectedWorkflowIds.length} workflow
                        {selectedWorkflowIds.length !== 1 ? 's' : ''} selected
                      </span>
                    ) : undefined
                  }
                />
              </FormField>
            )}

            <FormField label='Access'>
              <div className='flex items-center gap-3'>
                <ButtonGroup
                  value={formData.isPublic ? 'public' : 'private'}
                  onValueChange={(value) =>
                    setFormData({ ...formData, isPublic: value === 'public' })
                  }
                >
                  <ButtonGroupItem value='private'>API Key</ButtonGroupItem>
                  <ButtonGroupItem value='public'>Public</ButtonGroupItem>
                </ButtonGroup>
                {formData.isPublic && (
                  <span className='text-[var(--text-muted)] text-xs'>
                    No authentication required
                  </span>
                )}
              </div>
            </FormField>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateServer}
            disabled={!isFormValid || createServerMutation.isPending}
            variant='primary'
          >
            {createServerMutation.isPending ? 'Adding...' : 'Add Server'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
