'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  type ComboboxOption,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
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
}

export function CreateWorkflowMcpServerModal({
  open,
  onOpenChange,
  workspaceId,
  workflowOptions,
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
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Add New MCP Server'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Add New MCP Server</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Server Name'
          value={formData.name}
          onChange={(value) => setFormData({ ...formData, name: value })}
          required
          placeholder='e.g., My MCP Server'
        />
        <ChipModalField
          type='textarea'
          title='Description'
          value={formData.description}
          onChange={(value) => setFormData({ ...formData, description: value })}
          placeholder='Describe what this MCP server does (optional)'
        />
        {showWorkflows && (
          <ChipModalField type='custom' title='Workflows'>
            <ChipSelect
              options={workflowOptions ?? []}
              multiSelect
              multiSelectValues={selectedWorkflowIds}
              onMultiSelectChange={setSelectedWorkflowIds}
              placeholder='Select workflows...'
              searchable
              searchPlaceholder='Search workflows...'
              disabled={createServerMutation.isPending}
              fullWidth
              dropdownWidth='trigger'
              align='start'
              displayLabel={
                selectedWorkflowIds.length > 0
                  ? `${selectedWorkflowIds.length} workflow${selectedWorkflowIds.length !== 1 ? 's' : ''} selected`
                  : undefined
              }
            />
          </ChipModalField>
        )}
        <ChipModalField type='custom' title='Access'>
          <div className='flex items-center gap-3'>
            <ButtonGroup
              value={formData.isPublic ? 'public' : 'private'}
              onValueChange={(value) => setFormData({ ...formData, isPublic: value === 'public' })}
            >
              <ButtonGroupItem value='private'>API Key</ButtonGroupItem>
              <ButtonGroupItem value='public'>Public</ButtonGroupItem>
            </ButtonGroup>
            {formData.isPublic && (
              <span className='text-[var(--text-muted)] text-xs'>No authentication required</span>
            )}
          </div>
        </ChipModalField>
        <ChipModalError>{createServerMutation.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{
          label: createServerMutation.isPending ? 'Adding...' : 'Add Server',
          onClick: handleCreateServer,
          disabled: !isFormValid || createServerMutation.isPending,
        }}
      />
    </ChipModal>
  )
}
