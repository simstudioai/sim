'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useTranslations } from 'next-intl'
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
} from '@/components/emcn'
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
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
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={tI18n('add_new_mcp_server')}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        {t('add_new_mcp_server')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title={t('server_name')}
          value={formData.name}
          onChange={(value) => setFormData({ ...formData, name: value })}
          required
          placeholder={t('e_g_my_mcp_server')}
        />
        <ChipModalField
          type='textarea'
          title={t('description')}
          value={formData.description}
          onChange={(value) => setFormData({ ...formData, description: value })}
          placeholder={t('describe_what_this_mcp_server_does')}
        />
        {showWorkflows && (
          <ChipModalField type='custom' title={t('workflows')}>
            <ChipSelect
              options={workflowOptions ?? []}
              multiSelect
              multiSelectValues={selectedWorkflowIds}
              onMultiSelectChange={setSelectedWorkflowIds}
              placeholder={t('select_workflows')}
              searchable
              searchPlaceholder={tI18n('search_workflows')}
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
        <ChipModalField type='custom' title={t('access')}>
          <div className='flex items-center gap-3'>
            <ButtonGroup
              value={formData.isPublic ? 'public' : 'private'}
              onValueChange={(value) => setFormData({ ...formData, isPublic: value === 'public' })}
            >
              <ButtonGroupItem value='private'>{t('api_key')}</ButtonGroupItem>
              <ButtonGroupItem value='public'>{t('public')}</ButtonGroupItem>
            </ButtonGroup>
            {formData.isPublic && (
              <span className='text-[var(--text-muted)] text-xs'>
                {t('no_authentication_required')}
              </span>
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
