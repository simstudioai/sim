import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'
import { CredentialSelector } from '../../credential-selector/credential-selector'
import { TriggerConfigSection } from './trigger-config-section'
import { TriggerInstructions } from './trigger-instructions'
import { TriggerTestResult } from './trigger-test-result'

const logger = createLogger('TriggerModal')

interface TriggerModalProps {
  isOpen: boolean
  onClose: () => void
  triggerPath: string
  triggerDef: TriggerConfig
  triggerConfig: Record<string, any>
  onSave?: (path: string, config: Record<string, any>) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  triggerId?: string
  blockId: string
}

export function TriggerModal({
  isOpen,
  onClose,
  triggerPath,
  triggerDef,
  triggerConfig: initialConfig,
  onSave,
  onDelete,
  triggerId,
  blockId,
}: TriggerModalProps) {
  const [config, setConfig] = useState<Record<string, any>>(initialConfig)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message?: string
    data?: any
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [generatedPath, setGeneratedPath] = useState('')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [dynamicOptions, setDynamicOptions] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({})

  // Monitor credential selection
  useEffect(() => {
    if (triggerDef.requiresCredentials && triggerDef.credentialProvider) {
      // Check if credentials are selected by monitoring the sub-block store
      const checkCredentials = () => {
        const subBlockStore = useSubBlockStore.getState()
        const credentialValue = subBlockStore.getValue(blockId, 'triggerCredentials')
        const hasCredential = Boolean(credentialValue)
        setHasCredentials(hasCredential)

        // If credential changed and it's a Gmail trigger, load labels
        if (hasCredential && credentialValue !== selectedCredentialId) {
          setSelectedCredentialId(credentialValue)
          if (triggerDef.provider === 'gmail') {
            loadGmailLabels(credentialValue)
          }
        }
      }

      checkCredentials()

      // Set up a subscription to monitor changes
      const unsubscribe = useSubBlockStore.subscribe(checkCredentials)

      return unsubscribe
    }
    // If credentials aren't required, set to true
    setHasCredentials(true)
  }, [
    blockId,
    triggerDef.requiresCredentials,
    triggerDef.credentialProvider,
    selectedCredentialId,
    triggerDef.provider,
  ])

  // Load Gmail labels for the selected credential
  const loadGmailLabels = async (credentialId: string) => {
    try {
      const response = await fetch(`/api/tools/gmail/labels?credentialId=${credentialId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.labels && Array.isArray(data.labels)) {
          const labelOptions = data.labels.map((label: any) => ({
            id: label.id,
            name: label.name,
          }))
          setDynamicOptions((prev) => ({
            ...prev,
            labelIds: labelOptions,
          }))
        }
      } else {
        logger.error('Failed to load Gmail labels:', response.statusText)
      }
    } catch (error) {
      logger.error('Error loading Gmail labels:', error)
    }
  }

  // Generate webhook path and URL
  useEffect(() => {
    // For triggers that don't use webhooks (like Gmail polling), skip URL generation
    if (triggerDef.requiresCredentials && !triggerDef.webhook) {
      setWebhookUrl('')
      setGeneratedPath('')
      return
    }

    let finalPath = triggerPath

    // If no path exists, generate one automatically
    if (!finalPath) {
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(2, 8)
      finalPath = `/${triggerDef.provider}/${timestamp}-${randomId}`
      setGeneratedPath(finalPath)
    }

    if (finalPath) {
      const baseUrl = window.location.origin
      setWebhookUrl(`${baseUrl}/api/webhooks/trigger${finalPath}`)
    }
  }, [triggerPath, triggerDef.provider, triggerDef.requiresCredentials, triggerDef.webhook])

  // Track changes
  useEffect(() => {
    const hasChanges = JSON.stringify(config) !== JSON.stringify(initialConfig)
    setHasUnsavedChanges(hasChanges)
  }, [config, initialConfig])

  const handleConfigChange = (fieldId: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [fieldId]: value,
    }))
  }

  const handleSave = async () => {
    if (!onSave) return

    setIsSaving(true)
    try {
      // Use the existing trigger path or the generated one
      const path = triggerPath || generatedPath

      if (!path) {
        logger.error('No webhook path available for saving trigger')
        return
      }

      const success = await onSave(path, config)
      if (success) {
        onClose()
      }
    } catch (error) {
      logger.error('Error saving trigger:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return

    setIsDeleting(true)
    try {
      const success = await onDelete()
      if (success) {
        onClose()
      }
    } catch (error) {
      logger.error('Error deleting trigger:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      // Generate test webhook call
      const testPayload = triggerDef.samplePayload

      const response = await fetch(webhookUrl, {
        method: triggerDef.webhook?.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...triggerDef.webhook?.headers,
        },
        body: JSON.stringify(testPayload),
      })

      const success = response.ok
      const message = success
        ? 'Test webhook sent successfully'
        : `Test failed: ${response.statusText}`

      setTestResult({
        success,
        message,
        data: testPayload,
      })
    } catch (error: any) {
      setTestResult({
        success: false,
        message: `Test failed: ${error.message}`,
      })
    } finally {
      setIsTesting(false)
    }
  }

  const isConfigValid = () => {
    // Check if credentials are required and available
    if (triggerDef.requiresCredentials && !hasCredentials) {
      return false
    }

    // Check required fields
    for (const [fieldId, fieldDef] of Object.entries(triggerDef.configFields)) {
      if (fieldDef.required && !config[fieldId]) {
        return false
      }
    }
    return true
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className='flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>
              {triggerDef.name} Configuration
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className='flex-1 overflow-y-auto px-6 py-6'>
          <div className='space-y-6'>
            {triggerDef.requiresCredentials && triggerDef.credentialProvider && (
              <div className='space-y-2 rounded-md border border-border bg-card p-4 shadow-sm'>
                <h3 className='font-medium text-sm'>Credentials</h3>
                <p className='text-muted-foreground text-sm'>
                  This trigger requires {triggerDef.credentialProvider.replace('-', ' ')}{' '}
                  credentials to access your account.
                </p>
                <CredentialSelector
                  blockId={blockId}
                  subBlock={{
                    id: 'triggerCredentials',
                    type: 'oauth-input' as const,
                    placeholder: `Select ${triggerDef.credentialProvider.replace('-', ' ')} credential`,
                    provider: triggerDef.credentialProvider as any,
                    requiredScopes: [],
                  }}
                  previewValue={null}
                />
              </div>
            )}

            <TriggerConfigSection
              triggerDef={triggerDef}
              config={config}
              onChange={handleConfigChange}
              webhookUrl={webhookUrl}
              dynamicOptions={dynamicOptions}
            />

            <TriggerTestResult testResult={testResult} />

            <TriggerInstructions
              instructions={triggerDef.instructions}
              webhookUrl={webhookUrl}
              samplePayload={triggerDef.samplePayload}
              triggerDef={triggerDef}
            />
          </div>
        </div>

        <DialogFooter className='border-t px-6 py-4'>
          <div className='flex w-full justify-between'>
            <div>
              {triggerId && (
                <Button
                  type='button'
                  variant='destructive'
                  onClick={handleDelete}
                  disabled={isDeleting || isSaving}
                  size='default'
                  className='h-10'
                >
                  {isDeleting ? (
                    <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
                  ) : (
                    <Trash2 className='mr-2 h-4 w-4' />
                  )}
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={handleTest}
                disabled={isTesting || isSaving || isDeleting || !isConfigValid() || !webhookUrl}
                className='h-10'
              >
                {isTesting && (
                  <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
                )}
                {isTesting ? 'Testing...' : 'Test Webhook'}
              </Button>
              <Button variant='outline' onClick={onClose} size='default' className='h-10'>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !isConfigValid()}
                className={cn(
                  'h-10',
                  isConfigValid() ? 'bg-primary hover:bg-primary/90' : '',
                  isSaving &&
                    'relative after:absolute after:inset-0 after:animate-pulse after:bg-white/20'
                )}
                size='default'
              >
                {isSaving && (
                  <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
                )}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
