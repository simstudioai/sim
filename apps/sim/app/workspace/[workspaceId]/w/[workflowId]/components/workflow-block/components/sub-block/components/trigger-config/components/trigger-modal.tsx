import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Info, RotateCcw, Trash2 } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  }, [config])

  // Track if credential has changed from initial snapshot (computed later once selectedCredentialId is declared)
  let hasCredentialChanged = false
  const [isDeleting, setIsDeleting] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [generatedPath, setGeneratedPath] = useState('')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  hasCredentialChanged = selectedCredentialId !== initialCredentialRef.current
  const [dynamicOptions, setDynamicOptions] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({})
  const lastCredentialIdRef = useRef<string | null>(null)
  const [testUrl, setTestUrl] = useState<string | null>(null)
  const [testUrlExpiresAt, setTestUrlExpiresAt] = useState<string | null>(null)
  const [isGeneratingTestUrl, setIsGeneratingTestUrl] = useState(false)
  const [copiedTestUrl, setCopiedTestUrl] = useState(false)

  // Reset provider-dependent config fields when credentials change
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

  // Initialize config with default values from trigger definition
  useEffect(() => {
    const defaultConfig: Record<string, any> = {}

    // Apply default values from trigger definition
    Object.entries(triggerDef.configFields).forEach(([fieldId, field]) => {
      if (field.defaultValue !== undefined && !(fieldId in initialConfig)) {
        defaultConfig[fieldId] = field.defaultValue
      }
    })

    // Merge with initial config, prioritizing initial config values
    const mergedConfig = { ...defaultConfig, ...initialConfig }

    // Only update if there are actually default values to apply
    if (Object.keys(defaultConfig).length > 0) {
      setConfig(mergedConfig)
    }
  }, [triggerDef.configFields, initialConfig])

  // Monitor credential selection across collaborators; clear options on change/clear
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

        // If credential was cleared by another user, reset local state and dynamic options
        if (!hasCredential) {
          if (selectedCredentialId !== null) {
            setSelectedCredentialId(null)
          }
          // Clear provider-specific dynamic options
          setDynamicOptions({})
          // Per requirements: only clear dependent selections on actual credential CHANGE,
          // not when it becomes empty. So we do NOT reset fields here.
          lastCredentialIdRef.current = null
          return
        }

        // If credential changed, clear options immediately and load for new cred
        const previousCredentialId = lastCredentialIdRef.current

        // First detection (prev null → current non-null): do not clear selections
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

        // Real change (prev non-null → different non-null): clear dependent selections
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

  // Load Outlook folders for the selected credential
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
    // For triggers that don't use webhooks (like Gmail polling), skip URL generation
    if (triggerDef.requiresCredentials && !triggerDef.webhook) {
      setWebhookUrl('')
      setGeneratedPath('')
      return
    }

    let finalPath = triggerPath

    // If no path exists and we haven't generated one yet, generate one
    if (!finalPath && !generatedPath) {
      // Use UUID format consistent with other webhooks
      const newPath = crypto.randomUUID()
      setGeneratedPath(newPath)
      finalPath = newPath
    } else if (generatedPath && !triggerPath) {
      // Use the already generated path
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

  const handleCopyTestUrl = () => {
    if (testUrl) {
      navigator.clipboard.writeText(testUrl)
      setCopiedTestUrl(true)
      setTimeout(() => setCopiedTestUrl(false), 2000)
    }
  }

  const generateTestUrl = async () => {
    try {
      if (!triggerId) {
        logger.warn('Cannot generate test URL until trigger is saved')
        return
      }

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
      setConfig((prev) => ({
        ...prev,
        testUrl: json.url,
        testUrlExpiresAt: json.expiresAt,
      }))
    } catch (e) {
      logger.error('Failed to generate test webhook URL', { error: e })
    } finally {
      setIsGeneratingTestUrl(false)
    }
  }

  // Generate test URL only once when needed (skip if one is already provided in initialConfig)
  useEffect(() => {
    const initialTestUrl = (initialConfig as any)?.testUrl as string | undefined
    if (isOpen && triggerDef.webhook && !testUrl && !isGeneratingTestUrl && !initialTestUrl) {
      generateTestUrl()
    }
  }, [isOpen, triggerDef.webhook, testUrl, isGeneratingTestUrl, initialConfig])

  // Clear test URL when triggerId changes (after save)
  useEffect(() => {
    if (triggerId !== initialConfigRef.current?.triggerId) {
      setTestUrl(null)
      setTestUrlExpiresAt(null)
    }
  }, [triggerId])

  // Initialize saved test URL from initial config if present
  useEffect(() => {
    const url = (initialConfig as any)?.testUrl as string | undefined
    const expires = (initialConfig as any)?.testUrlExpiresAt as string | undefined
    if (url) setTestUrl(url)
    if (expires) setTestUrlExpiresAt(expires)
  }, [initialConfig])

  const handleSave = async () => {
    if (!onSave) return

    setIsSaving(true)
    try {
      // Use the existing trigger path or the generated one
      const path = triggerPath || generatedPath

      // For credential-based triggers that don't use webhooks (like Gmail), path is optional
      const requiresPath = triggerDef.webhook !== undefined

      if (requiresPath && !path) {
        logger.error('No webhook path available for saving trigger')
        return
      }

      const success = await onSave(path || '', {
        ...config,
        ...(testUrl ? { testUrl } : {}),
        ...(testUrlExpiresAt ? { testUrlExpiresAt } : {}),
      })
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
        className='flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[800px]'
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
              blockId={blockId}
              triggerDef={triggerDef}
              config={config}
              onChange={handleConfigChange}
              webhookUrl={webhookUrl}
              dynamicOptions={dynamicOptions}
            />

            {triggerDef.webhook && (
              <div className='space-y-4 rounded-md border border-border bg-card p-4 shadow-sm'>
                <TooltipProvider delayDuration={0}>
                  <div className='space-y-1'>
                    <div className='flex items-center gap-2'>
                      <Label className='font-medium text-sm'>Test Webhook URL</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-6 w-6 p-1 text-gray-500'
                            aria-label='Learn more about Test Webhook URL'
                          >
                            <Info className='h-4 w-4' />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          align='center'
                          className='z-[100] max-w-[300px] p-3'
                          role='tooltip'
                        >
                          <p className='text-sm'>
                            Temporary URL for testing canvas state instead of deployed version.
                            Expires after 24 hours. You must save the trigger before generating a
                            test URL.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {testUrl ? (
                      <>
                        <div className='relative'>
                          <Input
                            value={testUrl}
                            readOnly
                            className={cn(
                              'h-9 cursor-text rounded-[8px] pr-20 font-mono text-xs',
                              'focus-visible:ring-2 focus-visible:ring-primary/20'
                            )}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <div className='absolute top-0.5 right-0.5 flex h-8 items-center gap-1 pr-1'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              onClick={generateTestUrl}
                              disabled={isGeneratingTestUrl || !triggerId}
                              className={cn(
                                'group h-7 w-7 rounded-md p-0',
                                'text-muted-foreground/60 transition-all duration-200',
                                'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
                                'active:scale-95',
                                'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                              )}
                            >
                              <RotateCcw
                                className={cn('h-3.5 w-3.5', isGeneratingTestUrl && 'animate-spin')}
                              />
                            </Button>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              className={cn(
                                'group h-7 w-7 rounded-md p-0',
                                'text-muted-foreground/60 transition-all duration-200',
                                'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
                                'active:scale-95',
                                'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                              )}
                              onClick={handleCopyTestUrl}
                            >
                              {copiedTestUrl ? (
                                <Check className='h-3.5 w-3.5' />
                              ) : (
                                <Copy className='h-3.5 w-3.5' />
                              )}
                            </Button>
                          </div>
                        </div>
                        {testUrlExpiresAt && (
                          <p className='text-muted-foreground text-xs'>
                            Expires: {new Date(testUrlExpiresAt).toLocaleString()}
                          </p>
                        )}
                      </>
                    ) : isGeneratingTestUrl ? (
                      <div className='text-muted-foreground text-sm'>Generating test URL...</div>
                    ) : null}
                  </div>
                </TooltipProvider>
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
                  className='h-9 rounded-[8px]'
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
                variant='outline'
                onClick={onClose}
                size='default'
                className='h-9 rounded-[8px]'
              >
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
                  'h-9 rounded-[8px]',
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
