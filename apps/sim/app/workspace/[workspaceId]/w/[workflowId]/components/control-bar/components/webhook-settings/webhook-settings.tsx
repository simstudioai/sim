'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { cn, generatePassword } from '@/lib/utils'
import type {
  LogLevel as StoreLogLevel,
  TriggerType as StoreTriggerType,
} from '@/stores/logs/filters/types'

const logger = createLogger('WebhookSettings')

type NotificationLogLevel = Exclude<StoreLogLevel, 'all'>
type NotificationTrigger = Exclude<StoreTriggerType, 'all'>

interface WebhookConfig {
  id: string
  url: string
  includeFinalOutput: boolean
  includeTraceSpans: boolean
  includeRateLimits: boolean
  includeUsageData: boolean
  levelFilter: NotificationLogLevel[]
  triggerFilter: NotificationTrigger[]
  active: boolean
  createdAt: string
  updatedAt: string
}

interface WebhookSettingsProps {
  workflowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WebhookSettings({ workflowId, open, onOpenChange }: WebhookSettingsProps) {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [copySuccess, setCopySuccess] = useState<Record<string, boolean>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [webhookToDelete, setWebhookToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [operationStatus, setOperationStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })
  const [testStatus, setTestStatus] = useState<{
    webhookId: string
    type: 'success' | 'error'
    message: string
  } | null>(null)

  interface EditableWebhookPayload {
    url: string
    secret: string
    includeFinalOutput: boolean
    includeTraceSpans: boolean
    includeRateLimits: boolean
    includeUsageData: boolean
    levelFilter: NotificationLogLevel[]
    triggerFilter: NotificationTrigger[]
  }

  // Filter webhooks based on search term
  const filteredWebhooks = webhooks.filter((webhook) =>
    webhook.url.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const [newWebhook, setNewWebhook] = useState<EditableWebhookPayload>({
    url: '',
    secret: '',
    includeFinalOutput: false,
    includeTraceSpans: false,
    includeRateLimits: false,
    includeUsageData: false,
    levelFilter: ['info', 'error'],
    triggerFilter: ['api', 'webhook', 'schedule', 'manual', 'chat'],
  })
  const [fieldErrors, setFieldErrors] = useState<{
    url?: string[]
    levelFilter?: string[]
    triggerFilter?: string[]
    general?: string[]
  }>({})

  useEffect(() => {
    if (open) {
      loadWebhooks()
    }
  }, [open, workflowId])

  const loadWebhooks = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/workflows/${workflowId}/log-webhook`)
      if (response.ok) {
        const data = await response.json()
        const list: WebhookConfig[] = data.data || []
        setWebhooks(list)
        // Show form if no webhooks exist
        if (list.length === 0) {
          setShowForm(true)
        }
      }
    } catch (error) {
      logger.error('Failed to load webhooks', { error })
      setOperationStatus({
        type: 'error',
        message: 'Failed to load webhook configurations',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const createWebhook = async () => {
    setFieldErrors({}) // Clear any previous errors

    if (!newWebhook.url) {
      setFieldErrors({ url: ['Please enter a webhook URL'] })
      return
    }

    // Validate URL format
    try {
      const url = new URL(newWebhook.url)
      if (!['http:', 'https:'].includes(url.protocol)) {
        setFieldErrors({ url: ['URL must start with http:// or https://'] })
        return
      }
    } catch {
      setFieldErrors({ url: ['Please enter a valid URL (e.g., https://example.com/webhook)'] })
      return
    }

    // Validate filters are not empty
    if (newWebhook.levelFilter.length === 0) {
      setFieldErrors({ levelFilter: ['Please select at least one log level filter'] })
      return
    }

    if (newWebhook.triggerFilter.length === 0) {
      setFieldErrors({ triggerFilter: ['Please select at least one trigger filter'] })
      return
    }

    // Check for duplicate URL
    const existingWebhook = webhooks.find((w) => w.url === newWebhook.url)
    if (existingWebhook) {
      setFieldErrors({ url: ['A webhook with this URL already exists'] })
      return
    }

    try {
      setIsCreating(true)
      setFieldErrors({})
      const response = await fetch(`/api/workflows/${workflowId}/log-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWebhook),
      })

      if (response.ok) {
        // Refresh the webhooks list to ensure consistency and avoid duplicates
        await loadWebhooks()
        setNewWebhook({
          url: '',
          secret: '',
          includeFinalOutput: false,
          includeTraceSpans: false,
          includeRateLimits: false,
          includeUsageData: false,
          levelFilter: ['info', 'error'],
          triggerFilter: ['api', 'webhook', 'schedule', 'manual', 'chat'],
        })
        setFieldErrors({})
        setShowForm(false)
        setOperationStatus({
          type: 'success',
          message: 'Webhook created successfully',
        })
      } else {
        const error = await response.json()
        // Show detailed validation errors if available
        if (error.details && Array.isArray(error.details)) {
          const errorMessages = error.details.map((e: any) => e.message || e.path?.join('.'))
          setFieldErrors({ general: [`Validation failed: ${errorMessages.join(', ')}`] })
        } else {
          setFieldErrors({ general: [error.error || 'Failed to create webhook'] })
        }
      }
    } catch (error) {
      logger.error('Failed to create webhook', { error })
      setFieldErrors({ general: ['Failed to create webhook. Please try again.'] })
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteClick = (webhookId: string) => {
    setWebhookToDelete(webhookId)
    setShowDeleteDialog(true)
  }

  const confirmDeleteWebhook = async () => {
    if (!webhookToDelete) return

    try {
      setIsDeleting(true)
      const response = await fetch(
        `/api/workflows/${workflowId}/log-webhook?webhookId=${webhookToDelete}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        // Refresh the webhooks list to ensure consistency
        await loadWebhooks()
        setOperationStatus({
          type: 'success',
          message: 'Webhook deleted successfully',
        })
      } else {
        setOperationStatus({
          type: 'error',
          message: 'Failed to delete webhook',
        })
      }
    } catch (error) {
      logger.error('Failed to delete webhook', { error })
      setOperationStatus({
        type: 'error',
        message: 'Failed to delete webhook',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
      setWebhookToDelete(null)
    }
  }

  const handleDeleteDialogClose = () => {
    setShowDeleteDialog(false)
    setWebhookToDelete(null)
  }

  const testWebhook = async (webhookId: string) => {
    try {
      setIsTesting(webhookId)
      const response = await fetch(
        `/api/workflows/${workflowId}/log-webhook/test?webhookId=${webhookId}`,
        {
          method: 'POST',
        }
      )

      if (response.ok) {
        const data = await response.json()
        if (data.data.success) {
          setTestStatus({
            webhookId,
            type: 'success',
            message: `Test webhook sent successfully (${data.data.status})`,
          })
        } else {
          setTestStatus({
            webhookId,
            type: 'error',
            message: `Test webhook failed: ${data.data.error || data.data.statusText}`,
          })
        }
      } else {
        setTestStatus({
          webhookId,
          type: 'error',
          message: 'Failed to send test webhook',
        })
      }
    } catch (error) {
      logger.error('Failed to test webhook', { error })
      setTestStatus({
        webhookId,
        type: 'error',
        message: 'Failed to test webhook',
      })
    } finally {
      setIsTesting(null)
    }
  }

  // Remove copyWebhookId function as it's not used

  const handleGeneratePassword = async () => {
    setIsGenerating(true)
    // Add a small delay for visual feedback
    await new Promise((resolve) => setTimeout(resolve, 300))
    const password = generatePassword(24)
    setNewWebhook({ ...newWebhook, secret: password })
    setFieldErrors({})
    setIsGenerating(false)
  }

  const copyToClipboard = (text: string, webhookId: string) => {
    navigator.clipboard.writeText(text)
    setCopySuccess((prev) => ({ ...prev, [webhookId]: true }))
    setTimeout(() => {
      setCopySuccess((prev) => ({ ...prev, [webhookId]: false }))
    }, 2000)
  }

  const [originalWebhook, setOriginalWebhook] = useState<WebhookConfig | null>(null)

  const startEditWebhook = (webhook: WebhookConfig) => {
    setEditingWebhookId(webhook.id)
    setOriginalWebhook(webhook)
    setNewWebhook({
      url: webhook.url,
      secret: '', // Don't expose the existing secret
      includeFinalOutput: webhook.includeFinalOutput,
      includeTraceSpans: webhook.includeTraceSpans,
      includeRateLimits: webhook.includeRateLimits || false,
      includeUsageData: webhook.includeUsageData || false,
      levelFilter: webhook.levelFilter,
      triggerFilter: webhook.triggerFilter,
    })
    setSearchTerm('')
    setShowForm(true)
  }

  const cancelEdit = () => {
    setEditingWebhookId(null)
    setOriginalWebhook(null)
    setFieldErrors({})
    setOperationStatus({ type: null, message: '' })
    setNewWebhook({
      url: '',
      secret: '',
      includeFinalOutput: false,
      includeTraceSpans: false,
      includeRateLimits: false,
      includeUsageData: false,
      levelFilter: ['info', 'error'],
      triggerFilter: ['api', 'webhook', 'schedule', 'manual', 'chat'],
    })
    setShowForm(false)
  }

  const hasChanges = () => {
    if (!originalWebhook) return false
    return (
      newWebhook.url !== originalWebhook.url ||
      newWebhook.includeFinalOutput !== originalWebhook.includeFinalOutput ||
      newWebhook.includeTraceSpans !== originalWebhook.includeTraceSpans ||
      newWebhook.includeRateLimits !== (originalWebhook.includeRateLimits || false) ||
      newWebhook.includeUsageData !== (originalWebhook.includeUsageData || false) ||
      JSON.stringify([...newWebhook.levelFilter].sort()) !==
        JSON.stringify([...originalWebhook.levelFilter].sort()) ||
      JSON.stringify([...newWebhook.triggerFilter].sort()) !==
        JSON.stringify([...originalWebhook.triggerFilter].sort()) ||
      newWebhook.secret !== ''
    )
  }

  const handleCloseModal = () => {
    cancelEdit()
    setOperationStatus({ type: null, message: '' })
    setTestStatus(null)
    setSearchTerm('')
    setShowDeleteDialog(false)
    setWebhookToDelete(null)
    onOpenChange(false)
  }

  const updateWebhook = async () => {
    if (!editingWebhookId) return

    // Validate URL format
    try {
      const url = new URL(newWebhook.url)
      if (!['http:', 'https:'].includes(url.protocol)) {
        setFieldErrors({ url: ['URL must start with http:// or https://'] })
        return
      }
    } catch {
      setFieldErrors({ url: ['Please enter a valid URL (e.g., https://example.com/webhook)'] })
      return
    }

    // Validate filters are not empty
    if (newWebhook.levelFilter.length === 0) {
      setFieldErrors({ levelFilter: ['Please select at least one log level filter'] })
      return
    }

    if (newWebhook.triggerFilter.length === 0) {
      setFieldErrors({ triggerFilter: ['Please select at least one trigger filter'] })
      return
    }

    // Check for duplicate URL (excluding current webhook)
    const existingWebhook = webhooks.find(
      (w) => w.url === newWebhook.url && w.id !== editingWebhookId
    )
    if (existingWebhook) {
      setFieldErrors({ url: ['A webhook with this URL already exists'] })
      return
    }

    try {
      setIsCreating(true)
      interface UpdateWebhookPayload {
        url: string
        includeFinalOutput: boolean
        includeTraceSpans: boolean
        includeRateLimits: boolean
        includeUsageData: boolean
        levelFilter: NotificationLogLevel[]
        triggerFilter: NotificationTrigger[]
        secret?: string
        active?: boolean
      }

      let updateData: UpdateWebhookPayload = {
        url: newWebhook.url,
        includeFinalOutput: newWebhook.includeFinalOutput,
        includeTraceSpans: newWebhook.includeTraceSpans,
        includeRateLimits: newWebhook.includeRateLimits,
        includeUsageData: newWebhook.includeUsageData,
        levelFilter: newWebhook.levelFilter,
        triggerFilter: newWebhook.triggerFilter,
      }

      // Only include secret if it was changed
      if (newWebhook.secret) {
        updateData = { ...updateData, secret: newWebhook.secret }
      }

      const response = await fetch(`/api/workflows/${workflowId}/log-webhook/${editingWebhookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        await loadWebhooks()
        cancelEdit()
        setOperationStatus({
          type: 'success',
          message: 'Webhook updated successfully',
        })
      } else {
        const error = await response.json()
        setFieldErrors({ general: [error.error || 'Failed to update webhook'] })
      }
    } catch (error) {
      logger.error('Failed to update webhook', { error })
      setFieldErrors({ general: ['Failed to update webhook'] })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleCloseModal}>
      <DialogContent className='flex h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[800px]'>
        {/* Hidden dummy inputs to prevent browser password manager autofill */}
        <input
          type='text'
          name='fakeusernameremembered'
          autoComplete='username'
          style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
          tabIndex={-1}
          readOnly
        />
        <input
          type='password'
          name='fakepasswordremembered'
          autoComplete='current-password'
          style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
          tabIndex={-1}
          readOnly
        />
        <input
          type='email'
          name='fakeemailremembered'
          autoComplete='email'
          style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
          tabIndex={-1}
          readOnly
        />
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <DialogTitle className='font-medium text-lg'>Webhook Notifications</DialogTitle>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col'>
          {/* Fixed Header with Search */}
          {!showForm && (
            <div className='flex-shrink-0 px-6 pt-4 pb-2'>
              <div className='flex h-9 w-56 items-center gap-2 rounded-lg border bg-transparent pr-2 pl-3'>
                <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
                <Input
                  placeholder='Search webhooks...'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                />
              </div>
            </div>
          )}

          {/* Scrollable Content */}
          <div className='min-h-0 flex-1 overflow-y-auto px-6'>
            <div className='h-full py-2'>
              {!showForm ? (
                <div className='space-y-2'>
                  {isLoading ? (
                    <div className='space-y-2'>
                      {/* Show 2 skeleton webhooks */}
                      {[1, 2].map((index) => (
                        <div key={index} className='flex flex-col gap-2'>
                          <Skeleton className='h-[14px] w-[65px] rounded-[4px]' />{' '}
                          {/* WEBHOOK 1/2 label */}
                          <div className='flex flex-col gap-2'>
                            <div className='flex items-center justify-between gap-4'>
                              <div className='flex flex-1 items-center gap-3'>
                                <Skeleton className='h-8 w-[250px] rounded-[8px]' /> {/* URL */}
                              </div>
                              <div className='flex items-center gap-2'>
                                <Skeleton className='h-9 w-9 rounded-[8px]' /> {/* Test */}
                                <Skeleton className='h-9 w-9 rounded-[8px]' /> {/* Edit */}
                                <Skeleton className='h-9 w-9 rounded-[8px]' /> {/* Delete */}
                              </div>
                            </div>
                            <div className='flex flex-wrap items-center gap-2 text-xs'>
                              {/* Level filters */}
                              <Skeleton className='h-[22px] w-8 rounded-md' />
                              <Skeleton className='h-[22px] w-10 rounded-md' />
                              <Skeleton className='h-1 w-1 rounded-full' /> {/* bullet */}
                              {/* Trigger filters */}
                              <Skeleton className='h-[22px] w-6 rounded-md' />
                              <Skeleton className='h-[22px] w-14 rounded-md' />
                              <Skeleton className='h-[22px] w-14 rounded-md' />
                              <Skeleton className='h-[22px] w-12 rounded-md' />
                              <Skeleton className='h-[22px] w-8 rounded-md' />
                              <Skeleton className='h-1 w-1 rounded-full' /> {/* bullet */}
                              {/* Data options */}
                              <Skeleton className='h-[22px] w-12 rounded-md' />
                              <Skeleton className='h-[22px] w-10 rounded-md' />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : webhooks.length === 0 ? (
                    <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
                      Click "Add Webhook" below to get started
                    </div>
                  ) : (
                    <>
                      {filteredWebhooks.map((webhook, index) => (
                        <div key={webhook.id} className='relative mb-4 flex flex-col gap-2'>
                          <Label className='font-normal text-muted-foreground text-xs uppercase'>
                            Webhook {index + 1}
                          </Label>
                          <div className='flex flex-col gap-2'>
                            <div className='flex items-center justify-between gap-4'>
                              <div className='flex flex-1 items-center gap-3'>
                                <div className='flex h-8 max-w-[400px] items-center overflow-hidden rounded-[8px] bg-muted px-3'>
                                  <code className='scrollbar-hide overflow-x-auto whitespace-nowrap font-mono text-foreground text-xs'>
                                    {webhook.url}
                                  </code>
                                </div>
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      onClick={() => copyToClipboard(webhook.url, webhook.id)}
                                      className={cn(
                                        'group relative h-8 w-8 rounded-md border border-border/40 bg-background/80 backdrop-blur-sm',
                                        'text-muted-foreground/70 shadow-sm transition-all duration-200',
                                        'hover:border-border hover:bg-muted/50 hover:text-foreground hover:shadow-md',
                                        'active:scale-95 active:shadow-sm',
                                        'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                      )}
                                    >
                                      {copySuccess[webhook.id] ? (
                                        <Check className='h-3.5 w-3.5 text-foreground' />
                                      ) : (
                                        <Copy className='h-3.5 w-3.5' />
                                      )}
                                      <span className='sr-only'>Copy webhook URL</span>
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content side='top' align='center'>
                                    Copy webhook URL
                                  </Tooltip.Content>
                                </Tooltip.Root>

                                {/* Test Status inline for this specific webhook */}
                                {testStatus &&
                                  testStatus.webhookId === webhook.id &&
                                  testStatus.type === 'error' && (
                                    <div className='flex items-center gap-2 text-red-600 text-xs dark:text-red-400'>
                                      <AlertCircle className='h-3 w-3 flex-shrink-0' />
                                      <span>{testStatus.message}</span>
                                    </div>
                                  )}
                              </div>

                              <div className='flex items-center gap-2'>
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      onClick={() => testWebhook(webhook.id)}
                                      disabled={isTesting === webhook.id}
                                      className={cn(
                                        'group relative h-8 w-8 rounded-md border border-border/40 bg-background/80 backdrop-blur-sm',
                                        'text-muted-foreground/70 shadow-sm transition-all duration-200',
                                        'hover:border-border hover:bg-muted/50 hover:text-foreground hover:shadow-md',
                                        'active:scale-95 active:shadow-sm',
                                        'disabled:cursor-not-allowed disabled:opacity-50',
                                        'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                      )}
                                    >
                                      <Play className='h-3.5 w-3.5' />
                                      <span className='sr-only'>Test webhook</span>
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content side='top' align='center'>
                                    Test webhook
                                  </Tooltip.Content>
                                </Tooltip.Root>
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      onClick={() => startEditWebhook(webhook)}
                                      className={cn(
                                        'group relative h-8 w-8 rounded-md border border-border/40 bg-background/80 backdrop-blur-sm',
                                        'text-muted-foreground/70 shadow-sm transition-all duration-200',
                                        'hover:border-border hover:bg-muted/50 hover:text-foreground hover:shadow-md',
                                        'active:scale-95 active:shadow-sm',
                                        'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                      )}
                                    >
                                      <Pencil className='h-3.5 w-3.5' />
                                      <span className='sr-only'>Edit webhook</span>
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content side='top' align='center'>
                                    Edit webhook
                                  </Tooltip.Content>
                                </Tooltip.Root>
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      onClick={() => handleDeleteClick(webhook.id)}
                                      className={cn(
                                        'group relative h-8 w-8 rounded-md border border-border/40 bg-background/80 backdrop-blur-sm',
                                        'text-muted-foreground/70 shadow-sm transition-all duration-200',
                                        'hover:border-border hover:bg-muted/50 hover:text-muted-foreground hover:shadow-md',
                                        'active:scale-95 active:shadow-sm',
                                        'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                      )}
                                    >
                                      <Trash2 className='h-3.5 w-3.5' />
                                      <span className='sr-only'>Delete webhook</span>
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content side='bottom' align='end'>
                                    Delete webhook
                                  </Tooltip.Content>
                                </Tooltip.Root>
                              </div>
                            </div>

                            <div className='flex flex-wrap items-center gap-2 text-xs'>
                              {webhook.levelFilter.map((level) => (
                                <span key={level} className='rounded-md bg-muted px-1.5 py-0.5'>
                                  {level}
                                </span>
                              ))}
                              <span className='text-muted-foreground'>•</span>
                              {webhook.triggerFilter.map((trigger) => (
                                <span key={trigger} className='rounded-md bg-muted px-1.5 py-0.5'>
                                  {trigger}
                                </span>
                              ))}
                              {(webhook.includeFinalOutput ||
                                webhook.includeTraceSpans ||
                                webhook.includeRateLimits ||
                                webhook.includeUsageData) && (
                                <>
                                  <span className='text-muted-foreground'>•</span>
                                  {webhook.includeFinalOutput && (
                                    <span className='rounded-md bg-muted px-1.5 py-0.5'>
                                      output
                                    </span>
                                  )}
                                  {webhook.includeTraceSpans && (
                                    <span className='rounded-md bg-muted px-1.5 py-0.5'>
                                      traces
                                    </span>
                                  )}
                                  {webhook.includeRateLimits && (
                                    <span className='rounded-md bg-muted px-1.5 py-0.5'>
                                      limits
                                    </span>
                                  )}
                                  {webhook.includeUsageData && (
                                    <span className='rounded-md bg-muted px-1.5 py-0.5'>usage</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {/* Show message when search has no results but there are webhooks */}
                      {searchTerm.trim() &&
                        filteredWebhooks.length === 0 &&
                        webhooks.length > 0 && (
                          <div className='py-8 text-center text-muted-foreground text-sm'>
                            No webhooks found matching "{searchTerm}"
                          </div>
                        )}
                    </>
                  )}
                </div>
              ) : (
                <div className='flex flex-col gap-4 pt-1'>
                  {/* Form Header */}
                  <div>
                    <h3 className='font-medium text-base'>
                      {editingWebhookId ? 'Edit Webhook' : 'Create New Webhook'}
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Configure webhook notifications for workflow executions
                    </p>
                  </div>

                  {/* General errors */}
                  {fieldErrors.general && fieldErrors.general.length > 0 && (
                    <div className='rounded-[8px] border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-950/20'>
                      <div className='flex items-start gap-2'>
                        <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />
                        <div className='space-y-1 text-red-800 text-sm dark:text-red-300'>
                          {fieldErrors.general.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className='flex flex-col gap-6'>
                    <div className='space-y-2'>
                      <Label htmlFor='url' className='font-medium text-sm'>
                        Webhook URL
                      </Label>
                      <Input
                        id='url'
                        type='url'
                        placeholder='https://your-app.com/webhook'
                        value={newWebhook.url}
                        onChange={(e) => {
                          setNewWebhook({ ...newWebhook, url: e.target.value })
                          setFieldErrors({ ...fieldErrors, url: undefined })
                        }}
                        className='h-9 rounded-[8px]'
                        autoComplete='off'
                        autoCorrect='off'
                        autoCapitalize='off'
                        spellCheck='false'
                        data-form-type='other'
                      />
                      <p className='text-muted-foreground text-xs'>
                        The URL where webhook notifications will be sent
                      </p>
                      {fieldErrors.url && fieldErrors.url.length > 0 && (
                        <div className='mt-1 space-y-1 text-red-400 text-xs dark:text-red-400'>
                          {fieldErrors.url.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className='space-y-2'>
                      <Label htmlFor='secret' className='font-medium text-sm'>
                        Secret (optional)
                      </Label>
                      <div className='relative'>
                        <Input
                          id='secret'
                          type='text'
                          placeholder='Webhook secret for signature verification'
                          value={newWebhook.secret}
                          onChange={(e) => {
                            setNewWebhook({ ...newWebhook, secret: e.target.value })
                            setFieldErrors({ ...fieldErrors, general: undefined })
                          }}
                          className='h-9 rounded-[8px] pr-32'
                          autoComplete='off'
                          autoCorrect='off'
                          autoCapitalize='off'
                          spellCheck='false'
                          data-form-type='other'
                          style={
                            !showSecret
                              ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
                              : undefined
                          }
                        />
                        <div className='absolute top-0.5 right-0.5 flex h-8 items-center gap-1 pr-1'>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={handleGeneratePassword}
                                disabled={isGenerating}
                                className={cn(
                                  'group h-7 w-7 rounded-md p-0',
                                  'text-muted-foreground/60 transition-all duration-200',
                                  'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
                                  'active:scale-95',
                                  'disabled:cursor-not-allowed disabled:opacity-50',
                                  'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                )}
                              >
                                <RefreshCw
                                  className={cn(
                                    'h-3.5 w-3.5 transition-transform duration-200',
                                    'group-hover:rotate-90',
                                    isGenerating && 'animate-spin'
                                  )}
                                />
                                <span className='sr-only'>Generate password</span>
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top' align='center'>
                              Generate secure secret
                            </Tooltip.Content>
                          </Tooltip.Root>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={() => copyToClipboard(newWebhook.secret, 'form')}
                                disabled={!newWebhook.secret}
                                className={cn(
                                  'group h-7 w-7 rounded-md p-0',
                                  'text-muted-foreground/60 transition-all duration-200',
                                  'hover:bg-muted/50 hover:text-foreground',
                                  'disabled:cursor-not-allowed disabled:opacity-30',
                                  'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                )}
                              >
                                {copySuccess.form ? (
                                  <Check className='h-3.5 w-3.5 text-foreground' />
                                ) : (
                                  <Copy className='h-3.5 w-3.5' />
                                )}
                                <span className='sr-only'>Copy secret</span>
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top' align='center'>
                              Copy secret
                            </Tooltip.Content>
                          </Tooltip.Root>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                className={cn(
                                  'group h-7 w-7 rounded-md p-0',
                                  'text-muted-foreground/60 transition-all duration-200',
                                  'hover:bg-muted/50 hover:text-foreground',
                                  'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                                )}
                                onClick={() => setShowSecret(!showSecret)}
                              >
                                {showSecret ? (
                                  <EyeOff className='h-3.5 w-3.5' />
                                ) : (
                                  <Eye className='h-3.5 w-3.5' />
                                )}
                                <span className='sr-only'>
                                  {showSecret ? 'Hide secret' : 'Show secret'}
                                </span>
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top' align='center'>
                              {showSecret ? 'Hide secret' : 'Show secret'}
                            </Tooltip.Content>
                          </Tooltip.Root>
                        </div>
                      </div>
                      <p className='text-muted-foreground text-xs'>
                        Used to sign webhook payloads with HMAC-SHA256
                      </p>
                    </div>

                    <div className='space-y-3'>
                      <Label className='font-medium text-sm'>Log Level Filters</Label>
                      <div className='space-y-3'>
                        {(['info', 'error'] as NotificationLogLevel[]).map((level) => (
                          <div key={level} className='flex items-center justify-between'>
                            <div className='flex flex-col'>
                              <Label className='font-normal text-sm capitalize'>{level} logs</Label>
                              <p className='text-muted-foreground text-xs'>
                                Receive notifications for {level} level logs
                              </p>
                            </div>
                            <Switch
                              checked={newWebhook.levelFilter.includes(level)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setNewWebhook({
                                    ...newWebhook,
                                    levelFilter: [...newWebhook.levelFilter, level],
                                  })
                                } else {
                                  setNewWebhook({
                                    ...newWebhook,
                                    levelFilter: newWebhook.levelFilter.filter((l) => l !== level),
                                  })
                                }
                                setFieldErrors({ ...fieldErrors, levelFilter: undefined })
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      {fieldErrors.levelFilter && fieldErrors.levelFilter.length > 0 && (
                        <div className='mt-1 space-y-1 text-red-400 text-xs dark:text-red-400'>
                          {fieldErrors.levelFilter.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className='space-y-3'>
                      <Label className='font-medium text-sm'>Trigger Type Filters</Label>
                      <div className='space-y-3'>
                        {(
                          ['api', 'webhook', 'schedule', 'manual', 'chat'] as NotificationTrigger[]
                        ).map((trigger) => (
                          <div key={trigger} className='flex items-center justify-between'>
                            <div className='flex flex-col'>
                              <Label className='font-normal text-sm capitalize'>
                                {trigger} triggers
                              </Label>
                              <p className='text-muted-foreground text-xs'>
                                Notify when workflow is triggered via {trigger}
                              </p>
                            </div>
                            <Switch
                              checked={newWebhook.triggerFilter.includes(trigger)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setNewWebhook({
                                    ...newWebhook,
                                    triggerFilter: [...newWebhook.triggerFilter, trigger],
                                  })
                                } else {
                                  setNewWebhook({
                                    ...newWebhook,
                                    triggerFilter: newWebhook.triggerFilter.filter(
                                      (t) => t !== trigger
                                    ),
                                  })
                                }
                                setFieldErrors({ ...fieldErrors, triggerFilter: undefined })
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      {fieldErrors.triggerFilter && fieldErrors.triggerFilter.length > 0 && (
                        <div className='mt-1 space-y-1 text-red-400 text-xs dark:text-red-400'>
                          {fieldErrors.triggerFilter.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className='space-y-3'>
                      <Label className='font-medium text-sm'>Include in Payload</Label>
                      <div className='mt-2 flex flex-col gap-3'>
                        <div className='flex items-center justify-between'>
                          <div className='flex flex-col'>
                            <Label className='font-normal text-sm'>Final output</Label>
                            <p className='text-muted-foreground text-xs'>
                              Include workflow execution results
                            </p>
                          </div>
                          <Switch
                            checked={newWebhook.includeFinalOutput}
                            onCheckedChange={(checked) =>
                              setNewWebhook({ ...newWebhook, includeFinalOutput: checked })
                            }
                          />
                        </div>
                        <div className='flex items-center justify-between'>
                          <div className='flex flex-col'>
                            <Label className='font-normal text-sm'>Trace spans</Label>
                            <p className='text-muted-foreground text-xs'>
                              Detailed execution steps
                            </p>
                          </div>
                          <Switch
                            checked={newWebhook.includeTraceSpans}
                            onCheckedChange={(checked) =>
                              setNewWebhook({ ...newWebhook, includeTraceSpans: checked })
                            }
                          />
                        </div>
                        <div className='flex items-center justify-between'>
                          <div className='flex flex-col'>
                            <Label className='font-normal text-sm'>Rate limits</Label>
                            <p className='text-muted-foreground text-xs'>
                              Workflow execution limits
                            </p>
                          </div>
                          <Switch
                            checked={newWebhook.includeRateLimits}
                            onCheckedChange={(checked) =>
                              setNewWebhook({ ...newWebhook, includeRateLimits: checked })
                            }
                          />
                        </div>
                        <div className='flex items-center justify-between'>
                          <div className='flex flex-col'>
                            <Label className='font-normal text-sm'>Usage data</Label>
                            <p className='text-muted-foreground text-xs'>
                              Billing period cost and limits
                            </p>
                          </div>
                          <Switch
                            checked={newWebhook.includeUsageData}
                            onCheckedChange={(checked) =>
                              setNewWebhook({ ...newWebhook, includeUsageData: checked })
                            }
                          />
                        </div>
                      </div>
                      <p className='mt-3 pb-2 text-muted-foreground text-xs'>
                        By default, only basic metadata and cost information is included
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className='flex-shrink-0 bg-background'>
          <div className='flex w-full items-center justify-between border-t px-6 py-4'>
            {showForm ? (
              <>
                <Button variant='outline' onClick={cancelEdit} className='h-9 rounded-[8px]'>
                  Back
                </Button>
                <Button
                  onClick={editingWebhookId ? updateWebhook : createWebhook}
                  disabled={
                    isCreating ||
                    !newWebhook.url ||
                    newWebhook.levelFilter.length === 0 ||
                    newWebhook.triggerFilter.length === 0 ||
                    (!!editingWebhookId && !hasChanges())
                  }
                  className='h-9 rounded-[8px] bg-[var(--brand-primary-hex)] font-[480] text-white shadow-[0_0_0_0_var(--brand-primary-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50 disabled:hover:shadow-none'
                >
                  {isCreating ? (
                    <>{editingWebhookId ? 'Updating...' : 'Creating...'}</>
                  ) : (
                    <>{editingWebhookId ? 'Update Webhook' : 'Create Webhook'}</>
                  )}
                </Button>
              </>
            ) : isLoading ? (
              <>
                <Skeleton className='h-9 w-[117px] rounded-[8px]' />
                <div />
              </>
            ) : (
              <>
                <Button
                  onClick={() => {
                    setSearchTerm('')
                    setShowForm(true)
                  }}
                  className='h-9 rounded-[8px] bg-[var(--brand-primary-hex)] px-3 font-[480] text-white shadow-[0_0_0_0_var(--brand-primary-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  <Plus className='h-4 w-4 stroke-[2px]' />
                  Add Webhook
                </Button>
                <div />
              </>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={handleDeleteDialogClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the webhook configuration and stop all notifications.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-[8px]' disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteWebhook}
              disabled={isDeleting}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
