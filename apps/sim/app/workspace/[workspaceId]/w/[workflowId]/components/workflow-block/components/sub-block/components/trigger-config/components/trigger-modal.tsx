import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, Copy, Info, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'
import { CredentialSelector } from '../../credential-selector/credential-selector'
import { TriggerConfigSection } from './trigger-config-section'
import { TriggerInstructions } from './trigger-instructions'

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
  workflowId: string
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
  workflowId,
}: TriggerModalProps) {
  const [config, setConfig] = useState<Record<string, any>>(initialConfig)
  const [isSaving, setIsSaving] = useState(false)

  // Snapshot initial values at open for stable dirty-checking across collaborators
  const initialConfigRef = useRef<Record<string, any>>(initialConfig)
  const initialCredentialRef = useRef<string | null>(null)

  // Capture initial credential on first detect
  useEffect(() => {
    if (initialCredentialRef.current !== null) return
    const subBlockStore = useSubBlockStore.getState()
    const cred = (subBlockStore.getValue(blockId, 'triggerCredentials') as string | null) || null
    initialCredentialRef.current = cred
  }, [blockId])

  // Track if config has changed from initial snapshot
  const hasConfigChanged = useMemo(() => {
    return JSON.stringify(config) !== JSON.stringify(initialConfigRef.current)
  }, [config, initialConfigRef.current])

  // Track if credential has changed from initial snapshot (computed later once selectedCredentialId is declared)
  let hasCredentialChanged = false
  const [isDeleting, setIsDeleting] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [generatedPath, setGeneratedPath] = useState('')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [isGeneratingTestUrl, setIsGeneratingTestUrl] = useState(false)
  const [testUrl, setTestUrl] = useState('')
  const [testUrlExpiresAt, setTestUrlExpiresAt] = useState('')
  const [copiedTest, setCopiedTest] = useState(false)
  hasCredentialChanged = selectedCredentialId !== initialCredentialRef.current
  const [dynamicOptions, setDynamicOptions] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({})
  const lastCredentialIdRef = useRef<string | null>(null)

  const resetFieldsForCredentialChange = () => {
    setConfig((prev) => {
      const next = { ...prev }
      if (triggerDef.provider === 'gmail') {
        if (Array.isArray(next.labelIds)) next.labelIds = []
      } else if (triggerDef.provider === 'outlook') {
        if (Array.isArray(next.folderIds)) next.folderIds = []
      } else if (triggerDef.provider === 'airtable') {
        if (typeof next.baseId === 'string') next.baseId = ''
        if (typeof next.tableId === 'string') next.tableId = ''
      }
      return next
    })
  }

  useEffect(() => {
    const defaultConfig: Record<string, any> = {}

    Object.entries(triggerDef.configFields).forEach(([fieldId, field]) => {
      if (field.defaultValue !== undefined && !(fieldId in initialConfig)) {
        defaultConfig[fieldId] = field.defaultValue
      }
    })

    const mergedConfig = { ...defaultConfig, ...initialConfig }

    if (Object.keys(defaultConfig).length > 0) {
      setConfig(mergedConfig)
    }
  }, [triggerDef.configFields, initialConfig])

  useEffect(() => {
    if (triggerDef.requiresCredentials && triggerDef.credentialProvider) {
      const checkCredentials = () => {
        const subBlockStore = useSubBlockStore.getState()
        const credentialValue = subBlockStore.getValue(blockId, 'triggerCredentials') as
          | string
          | null
        const currentCredentialId = credentialValue || null
        const hasCredential = Boolean(currentCredentialId)
        setHasCredentials(hasCredential)

        if (!hasCredential) {
          if (selectedCredentialId !== null) {
            setSelectedCredentialId(null)
          }
          setDynamicOptions({})
          lastCredentialIdRef.current = null
          return
        }

        const previousCredentialId = lastCredentialIdRef.current

        if (previousCredentialId === null) {
          setSelectedCredentialId(currentCredentialId)
          lastCredentialIdRef.current = currentCredentialId
          if (typeof currentCredentialId === 'string') {
            if (triggerDef.provider === 'gmail') {
              void loadGmailLabels(currentCredentialId)
            } else if (triggerDef.provider === 'outlook') {
              void loadOutlookFolders(currentCredentialId)
            }
          }
          return
        }

        if (
          typeof currentCredentialId === 'string' &&
          currentCredentialId !== previousCredentialId
        ) {
          setSelectedCredentialId(currentCredentialId)
          lastCredentialIdRef.current = currentCredentialId
          // Clear stale options before loading new ones
          setDynamicOptions({})
          // Clear any selected values that depend on the credential
          resetFieldsForCredentialChange()
          if (triggerDef.provider === 'gmail') {
            void loadGmailLabels(currentCredentialId)
          } else if (triggerDef.provider === 'outlook') {
            void loadOutlookFolders(currentCredentialId)
          }
        }
      }

      checkCredentials()
      const unsubscribe = useSubBlockStore.subscribe(checkCredentials)
      return unsubscribe
    }
    setHasCredentials(true)
  }, [
    blockId,
    triggerDef.requiresCredentials,
    triggerDef.credentialProvider,
    selectedCredentialId,
    triggerDef.provider,
  ])

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

  const loadOutlookFolders = async (credentialId: string) => {
    try {
      const response = await fetch(`/api/tools/outlook/folders?credentialId=${credentialId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.folders && Array.isArray(data.folders)) {
          const folderOptions = data.folders.map((folder: any) => ({
            id: folder.id,
            name: folder.name,
          }))
          setDynamicOptions((prev) => ({
            ...prev,
            folderIds: folderOptions,
          }))
        }
      } else {
        logger.error('Failed to load Outlook folders:', response.statusText)
      }
    } catch (error) {
      logger.error('Error loading Outlook folders:', error)
    }
  }

  // Generate webhook path and URL
  useEffect(() => {
    if (triggerDef.requiresCredentials && !triggerDef.webhook) {
      setWebhookUrl('')
      setGeneratedPath('')
      return
    }

    let finalPath = triggerPath

    if (!finalPath && !generatedPath) {
      const newPath = crypto.randomUUID()
      setGeneratedPath(newPath)
      finalPath = newPath
    } else if (generatedPath && !triggerPath) {
      finalPath = generatedPath
    }

    if (finalPath) {
      const baseUrl = window.location.origin
      setWebhookUrl(`${baseUrl}/api/webhooks/trigger/${finalPath}`)
    }
  }, [
    triggerPath,
    generatedPath,
    triggerDef.provider,
    triggerDef.requiresCredentials,
    triggerDef.webhook,
  ])

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
      const path = triggerPath || generatedPath

      const requiresPath = triggerDef.webhook !== undefined

      if (requiresPath && !path) {
        logger.error('No webhook path available for saving trigger')
        setIsSaving(false)
        return
      }

      const success = await onSave(path || '', config)
      if (success) {
        initialConfigRef.current = JSON.parse(JSON.stringify(config))
        initialCredentialRef.current = selectedCredentialId
        if (triggerDef.requiresCredentials && !triggerDef.webhook) {
          setIsSaving(false)
          handleClose()
          return
        }

        setIsSaving(false)
      } else {
        setIsSaving(false)
      }
    } catch (error) {
      logger.error('Error saving trigger:', error)
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return

    setIsDeleting(true)
    try {
      const success = await onDelete()
      if (success) {
        handleClose()
      }
    } catch (error) {
      logger.error('Error deleting trigger:', error)
    } finally {
      setIsDeleting(false)
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

  const generateTestUrl = async () => {
    if (!triggerId) return
    try {
      setIsGeneratingTestUrl(true)
      const res = await fetch(`/api/webhooks/${triggerId}/test-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'Failed to generate test URL')
      }
      const json = await res.json()
      setTestUrl(json.url)
      setTestUrlExpiresAt(json.expiresAt)
    } catch (e) {
      logger.error('Failed to generate test webhook URL', { error: e })
    } finally {
      setIsGeneratingTestUrl(false)
    }
  }

  // Auto-generate test URL when a trigger exists (after save)
  useEffect(() => {
    if (!triggerId) return
    if (testUrl) return
    // Only generate for webhook triggers
    if (triggerDef.requiresCredentials && !triggerDef.webhook) return

    logger.info('Trigger saved, generating test URL', { triggerId })
    void generateTestUrl()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerId])

  const copyTestUrl = async () => {
    if (!testUrl) return
    try {
      await navigator.clipboard.writeText(testUrl)
      setCopiedTest(true)
      setTimeout(() => setCopiedTest(false), 1500)
    } catch (e) {
      logger.error('Failed to copy test URL', { error: e })
    }
  }

  const handleClose = () => {
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className='flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[650px]'
        hideCloseButton
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <DialogTitle className='font-medium text-lg'>
                {triggerDef.name} Configuration
              </DialogTitle>
              {triggerId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant='outline'
                      className='flex items-center gap-1 border-green-200 bg-green-50 font-normal text-green-600 text-xs hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                    >
                      <div className='relative mr-0.5 flex items-center justify-center'>
                        <div className='absolute h-3 w-3 rounded-full bg-green-500/20' />
                        <div className='relative h-2 w-2 rounded-full bg-green-500' />
                      </div>
                      Active Trigger
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' className='max-w-[300px] p-4'>
                    <p className='text-sm'>{triggerDef.name}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
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

            {/* Only show test URL section for webhook-based triggers */}
            {(!triggerDef.requiresCredentials || triggerDef.webhook) && (
              <div className='space-y-2 rounded-md border border-border bg-card p-4 shadow-sm'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='test-webhook-url' className='font-medium text-sm'>
                    Test Webhook URL
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-6 w-6 p-1 text-gray-500'
                        aria-label='Learn more about test webhook URL'
                      >
                        <Info className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side='right'
                      align='center'
                      className='z-[100] max-w-[320px] p-3'
                    >
                      <p className='text-sm'>
                        Use this URL to send test webhooks that run against the live workflow state
                        without changing the deployed version.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className='flex'>
                  <div className='relative flex-1'>
                    <Input
                      id='test-webhook-url'
                      readOnly
                      value={testUrl}
                      placeholder={
                        triggerId
                          ? testUrl
                            ? ''
                            : 'Generating test URL...'
                          : 'Save the trigger to enable test URL'
                      }
                      className={cn(
                        'h-10 flex-1 cursor-text rounded-[8px] pr-24 font-mono text-xs',
                        'focus-visible:ring-2 focus-visible:ring-primary/20'
                      )}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      disabled={isGeneratingTestUrl}
                    />
                    <div className='absolute inset-y-0 right-0 z-10 flex items-center pr-1'>
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        className={cn(
                          'h-7 w-7 rounded-md p-0 text-muted-foreground/70',
                          'transition-colors hover:bg-transparent hover:text-foreground'
                        )}
                        onClick={copyTestUrl}
                        disabled={!testUrl || isGeneratingTestUrl}
                        aria-label='Copy test URL'
                      >
                        {copiedTest ? (
                          <CheckCheck className='h-3.5 w-3.5 text-green-500' />
                        ) : (
                          <Copy className='h-3.5 w-3.5' />
                        )}
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type='button'
                            size='sm'
                            variant='ghost'
                            className={cn(
                              'ml-1 h-7 w-7 rounded-md p-0 text-muted-foreground/70',
                              'transition-colors hover:bg-transparent hover:text-foreground'
                            )}
                            onClick={() => void generateTestUrl()}
                            disabled={isGeneratingTestUrl || !triggerId}
                            aria-label='Generate test URL'
                          >
                            <RefreshCw
                              className={cn('h-3.5 w-3.5', isGeneratingTestUrl && 'animate-spin')}
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side='top' align='center'>
                          {testUrl ? 'Refresh test URL' : 'Generate test URL'}
                        </TooltipContent>
                      </Tooltip>
                      <div className='pointer-events-none absolute top-[1px] right-[1px] bottom-[1px] z-[-1] w-10 rounded-r-[7px] bg-gradient-to-l from-background to-transparent' />
                    </div>
                  </div>
                </div>
                {testUrlExpiresAt && (
                  <p className='text-muted-foreground text-xs'>
                    Expires at: {new Date(testUrlExpiresAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

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
              <Button variant='outline' onClick={handleClose} size='default' className='h-10'>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  isSaving ||
                  !isConfigValid() ||
                  (!(hasConfigChanged || hasCredentialChanged) && !!triggerId)
                }
                className={cn(
                  'h-10',
                  isConfigValid() && (hasConfigChanged || hasCredentialChanged || !triggerId)
                    ? 'bg-primary hover:bg-primary/90'
                    : '',
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
