'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { FormConfigModal } from './components/form-config-modal'

const logger = createLogger('FormConfig')

interface FormConfigProps {
  blockId: string
  isConnecting: boolean
  isPreview?: boolean
  value?: {
    formId?: string
    formPath?: string
    formConfig?: Record<string, any>
  }
  disabled?: boolean
}

export function FormConfig({
  blockId,
  isConnecting,
  isPreview = false,
  value: propValue,
  disabled = false,
}: FormConfigProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const params = useParams()
  const workflowId = params.workflowId as string

  const [storeFormId, setFormId] = useSubBlockValue(blockId, 'formId')
  const [storeFormPath, setFormPath] = useSubBlockValue(blockId, 'formPath')
  const [storeFormConfig, setFormConfig] = useSubBlockValue(blockId, 'formConfig')

  const formId = propValue?.formId ?? storeFormId
  const formPath = propValue?.formPath ?? storeFormPath
  const formConfig = propValue?.formConfig ?? storeFormConfig

  const hasFormConfigured = formId && formPath

  const refreshFormState = useCallback(async () => {
    if (isPreview) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}/forms?blockId=${blockId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.forms && data.forms.length > 0) {
          const form = data.forms[0]
          setFormId(form.id)
          setFormPath(form.path)
          setFormConfig(form.formConfig)
        }
      }
    } catch (error) {
      logger.error('Failed to refresh form state', error)
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, blockId, isPreview, setFormId, setFormPath, setFormConfig])

  useEffect(() => {
    refreshFormState()
  }, [refreshFormState])

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true)
    setError(null)
  }, [])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  const handleSaveForm = useCallback(
    async (config: any) => {
      setIsSaving(true)
      setError(null)

      try {
        const method = formId ? 'PUT' : 'POST'
        const response = await fetch(`/api/workflows/${workflowId}/forms`, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            blockId,
            title: config.title,
            description: config.description,
            formConfig: config,
            settings: config.settings,
            styling: {},
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to save form: ${response.statusText}`)
        }

        const result = await response.json()

        setFormId(result.id)
        setFormPath(result.path)
        setFormConfig(config)

        setIsModalOpen(false)
        logger.info('Form configuration saved successfully', { formId: result.id })
      } catch (error: any) {
        logger.error('Failed to save form configuration', error)
        setError(error.message || 'Failed to save form configuration')
      } finally {
        setIsSaving(false)
      }
    },
    [workflowId, blockId, setFormId, setFormPath, setFormConfig]
  )

  if (isPreview) {
    return (
      <div className='space-y-2'>
        <div className='text-muted-foreground text-sm'>
          Form: {formPath ? `sim.ai/form/${formPath}` : 'Not configured'}
        </div>
        {hasFormConfigured && (
          <div className='text-muted-foreground text-xs'>
            {formConfig?.fields?.length || 0} fields configured
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {error && <div className='text-destructive text-sm'>{error}</div>}

      {hasFormConfigured ? (
        <div className='space-y-2'>
          <div
            className='cursor-pointer rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/20 hover:bg-muted/50'
            onClick={handleOpenModal}
            title='Click to edit form'
          >
            <div className='flex items-center justify-between gap-2'>
              <div className='min-w-0 truncate text-muted-foreground text-sm'>
                <span className='mr-2 text-xs'>Form URL:</span>
                <span className='font-mono text-foreground/80 text-xs'>sim.ai/form/{formPath}</span>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-8 w-8 shrink-0'
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(`${window.location.origin}/form/${formPath}`, '_blank')
                }}
                disabled={!formPath}
              >
                <ExternalLink className='h-4 w-4' />
              </Button>
            </div>

            <div className='mt-3'>
              <div className='mb-1 font-medium text-sm'>Fields</div>
              <div className='flex flex-wrap gap-2'>
                {(formConfig?.fields || []).map((f: any) => (
                  <div
                    key={f.id || f.name}
                    className='inline-flex items-center gap-2 rounded-full border bg-card px-2.5 py-1'
                  >
                    <span className='rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]'>
                      {f?.name || f?.label || 'unnamed'}
                    </span>
                    <span className='text-muted-foreground text-xs'>{f?.type || 'text'}</span>
                    {f?.required ? <span className='text-destructive text-xs'>*</span> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          className='flex h-10 w-full items-center bg-background font-normal text-sm'
          onClick={handleOpenModal}
          disabled={isConnecting || isSaving || isPreview || disabled}
        >
          {isLoading ? (
            <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          ) : (
            <ExternalLink className='mr-2 h-4 w-4' />
          )}
          Configure Form
        </Button>
      )}

      <FormConfigModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSave={handleSaveForm}
        initialConfig={formConfig}
        isSaving={isSaving}
        formPath={formPath || undefined}
      />
    </div>
  )
}
