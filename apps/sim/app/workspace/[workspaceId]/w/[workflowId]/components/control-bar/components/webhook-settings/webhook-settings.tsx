'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bell,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
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
  const [activeTab, setActiveTab] = useState<string>('webhooks')

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
  const [formError, setFormError] = useState<string | null>(null)

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
        setWebhooks(data.data || [])
      }
    } catch (error) {
      logger.error('Failed to load webhooks', { error })
      toast.error('Failed to load webhook configurations')
    } finally {
      setIsLoading(false)
    }
  }

  const createWebhook = async () => {
    setFormError(null) // Clear any previous errors

    if (!newWebhook.url) {
      setFormError('Please enter a webhook URL')
      return
    }

    // Validate URL format
    try {
      const url = new URL(newWebhook.url)
      if (!['http:', 'https:'].includes(url.protocol)) {
        setFormError('URL must start with http:// or https://')
        return
      }
    } catch {
      setFormError('Please enter a valid URL (e.g., https://example.com/webhook)')
      return
    }

    // Validate filters are not empty
    if (newWebhook.levelFilter.length === 0) {
      setFormError('Please select at least one log level filter')
      return
    }

    if (newWebhook.triggerFilter.length === 0) {
      setFormError('Please select at least one trigger filter')
      return
    }

    // Check for duplicate URL
    const existingWebhook = webhooks.find((w) => w.url === newWebhook.url)
    if (existingWebhook) {
      setFormError('A webhook with this URL already exists')
      return
    }

    try {
      setIsCreating(true)
      setFormError(null)
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
        setFormError(null)
        toast.success('Webhook created successfully')
      } else {
        const error = await response.json()
        // Show detailed validation errors if available
        if (error.details && Array.isArray(error.details)) {
          const errorMessages = error.details.map((e: any) => e.message || e.path?.join('.'))
          setFormError(`Validation failed: ${errorMessages.join(', ')}`)
        } else {
          setFormError(error.error || 'Failed to create webhook')
        }
      }
    } catch (error) {
      logger.error('Failed to create webhook', { error })
      setFormError('Failed to create webhook. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  const deleteWebhook = async (webhookId: string) => {
    try {
      const response = await fetch(
        `/api/workflows/${workflowId}/log-webhook?webhookId=${webhookId}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        // Refresh the webhooks list to ensure consistency
        await loadWebhooks()
        toast.success('Webhook deleted')
      } else {
        toast.error('Failed to delete webhook')
      }
    } catch (error) {
      logger.error('Failed to delete webhook', { error })
      toast.error('Failed to delete webhook')
    }
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
          toast.success(`Test webhook sent successfully (${data.data.status})`)
        } else {
          toast.error(`Test webhook failed: ${data.data.error || data.data.statusText}`)
        }
      } else {
        toast.error('Failed to send test webhook')
      }
    } catch (error) {
      logger.error('Failed to test webhook', { error })
      toast.error('Failed to test webhook')
    } finally {
      setIsTesting(null)
    }
  }

  const copyWebhookId = (id: string) => {
    navigator.clipboard.writeText(id)
    toast.success('Webhook ID copied')
  }

  const startEditWebhook = (webhook: WebhookConfig) => {
    setEditingWebhookId(webhook.id)
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
  }

  const cancelEdit = () => {
    setEditingWebhookId(null)
    setFormError(null)
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
  }

  const updateWebhook = async () => {
    if (!editingWebhookId) return

    // Validate URL format
    try {
      const url = new URL(newWebhook.url)
      if (!['http:', 'https:'].includes(url.protocol)) {
        toast.error('URL must start with http:// or https://')
        return
      }
    } catch {
      toast.error('Please enter a valid URL (e.g., https://example.com/webhook)')
      return
    }

    // Validate filters are not empty
    if (newWebhook.levelFilter.length === 0) {
      toast.error('Please select at least one log level filter')
      return
    }

    if (newWebhook.triggerFilter.length === 0) {
      toast.error('Please select at least one trigger filter')
      return
    }

    // Check for duplicate URL (excluding current webhook)
    const existingWebhook = webhooks.find(
      (w) => w.url === newWebhook.url && w.id !== editingWebhookId
    )
    if (existingWebhook) {
      toast.error('A webhook with this URL already exists')
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
        toast.success('Webhook updated successfully')
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to update webhook')
      }
    } catch (error) {
      logger.error('Failed to update webhook', { error })
      toast.error('Failed to update webhook')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] max-w-3xl flex-col'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Webhook className='h-5 w-5' />
            Webhook Notifications
          </DialogTitle>
          <DialogDescription>
            Configure webhooks to receive notifications when workflow executions complete
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={editingWebhookId ? 'create' : activeTab}
          className='mt-4 flex min-h-0 flex-1 flex-col'
          onValueChange={(value) => {
            setActiveTab(value)
            setFormError(null) // Clear any form errors when switching tabs
            if (value === 'webhooks') {
              loadWebhooks()
              cancelEdit() // Cancel any ongoing edit
            }
          }}
        >
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='webhooks'>Active Webhooks</TabsTrigger>
            <TabsTrigger value='create'>
              {editingWebhookId ? 'Edit Webhook' : 'Create New'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value='webhooks' className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <div className='min-h-[600px] flex-1 overflow-y-auto px-4'>
              {isLoading ? (
                <div className='flex h-full items-center justify-center'>
                  <RefreshCw className='h-5 w-5 animate-spin text-muted-foreground' />
                </div>
              ) : webhooks.length === 0 ? (
                <div className='flex h-full items-center justify-center'>
                  <Card className='w-full'>
                    <CardContent className='flex flex-col items-center justify-center py-8'>
                      <Bell className='mb-3 h-8 w-8 text-muted-foreground' />
                      <p className='text-center text-muted-foreground text-sm'>
                        No webhooks configured yet
                      </p>
                      <p className='text-center text-muted-foreground text-xs'>
                        Create a webhook to receive execution notifications
                      </p>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className='space-y-3'>
                  {webhooks.map((webhook) => (
                    <Card key={webhook.id}>
                      <CardHeader className='pb-3'>
                        <div className='flex items-start justify-between'>
                          <div className='flex-1'>
                            <CardTitle className='font-mono text-sm'>{webhook.url}</CardTitle>
                            <CardDescription className='mt-1 flex items-center gap-4 text-xs'>
                              <span className='flex items-center gap-1'>
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    webhook.active ? 'bg-green-500' : 'bg-gray-400'
                                  }`}
                                />
                                {webhook.active ? 'Active' : 'Inactive'}
                              </span>
                              <span>
                                Created {new Date(webhook.createdAt).toLocaleDateString()}
                              </span>
                            </CardDescription>
                          </div>
                          <div className='flex gap-1'>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  onClick={() => copyWebhookId(webhook.id)}
                                >
                                  <Copy className='h-4 w-4' />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy Webhook ID</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  onClick={() => testWebhook(webhook.id)}
                                  disabled={isTesting === webhook.id}
                                >
                                  {isTesting === webhook.id ? (
                                    <RefreshCw className='h-4 w-4 animate-spin' />
                                  ) : (
                                    <Bell className='h-4 w-4' />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isTesting === webhook.id ? 'Testing...' : 'Test Webhook'}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  onClick={() => startEditWebhook(webhook)}
                                >
                                  <Edit2 className='h-4 w-4' />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit Webhook</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  onClick={() => deleteWebhook(webhook.id)}
                                >
                                  <Trash2 className='h-4 w-4' />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete Webhook</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-3 text-xs'>
                        <div className='flex gap-6'>
                          <div>
                            <span className='text-muted-foreground'>Levels:</span>{' '}
                            {webhook.levelFilter.join(', ')}
                          </div>
                          <div>
                            <span className='text-muted-foreground'>Triggers:</span>{' '}
                            {webhook.triggerFilter.join(', ')}
                          </div>
                        </div>
                        <div className='flex flex-wrap gap-x-6 gap-y-2.5'>
                          <div className='flex items-center gap-1'>
                            <Checkbox checked={webhook.includeFinalOutput} disabled />
                            <span className='text-muted-foreground'>Include output</span>
                          </div>
                          <div className='flex items-center gap-1'>
                            <Checkbox checked={webhook.includeTraceSpans} disabled />
                            <span className='text-muted-foreground'>Include trace spans</span>
                          </div>
                          <div className='flex items-center gap-1'>
                            <Checkbox checked={webhook.includeUsageData} disabled />
                            <span className='text-muted-foreground'>Include usage data</span>
                          </div>
                          <div className='flex items-center gap-1'>
                            <Checkbox checked={webhook.includeRateLimits} disabled />
                            <span className='text-muted-foreground'>Include rate limits</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value='create' className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <div className='flex-1 overflow-y-auto px-4'>
              {formError && (
                <div className='mb-4 rounded-md border border-red-200 bg-red-50 p-3'>
                  <div className='flex items-start gap-2'>
                    <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600' />
                    <p className='text-red-800 text-sm'>{formError}</p>
                  </div>
                </div>
              )}
              <div className='space-y-4 pb-6'>
                <div>
                  <Label htmlFor='url'>Webhook URL</Label>
                  <Input
                    id='url'
                    type='url'
                    placeholder='https://your-app.com/webhook'
                    value={newWebhook.url}
                    onChange={(e) => {
                      setNewWebhook({ ...newWebhook, url: e.target.value })
                      setFormError(null) // Clear error when user types
                    }}
                    className='mt-1.5'
                  />
                </div>

                <div>
                  <Label htmlFor='secret'>Secret (optional)</Label>
                  <div className='relative mt-1.5'>
                    <Input
                      id='secret'
                      type={showSecret ? 'text' : 'password'}
                      placeholder='Webhook secret for signature verification'
                      value={newWebhook.secret}
                      onChange={(e) => {
                        setNewWebhook({ ...newWebhook, secret: e.target.value })
                        setFormError(null) // Clear error when user types
                      }}
                      className='pr-10'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='absolute top-0 right-0 h-full px-3'
                      onClick={() => setShowSecret(!showSecret)}
                    >
                      {showSecret ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                    </Button>
                  </div>
                  <p className='mt-2 text-muted-foreground text-xs'>
                    Used to sign webhook payloads with HMAC-SHA256
                  </p>
                </div>

                <Separator />

                <div className='space-y-3'>
                  <Label>Filter by Level</Label>
                  <div className='flex gap-4'>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id='level-info'
                        checked={newWebhook.levelFilter.includes('info')}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setNewWebhook({
                              ...newWebhook,
                              levelFilter: [...newWebhook.levelFilter, 'info'],
                            })
                          } else {
                            setNewWebhook({
                              ...newWebhook,
                              levelFilter: newWebhook.levelFilter.filter((l) => l !== 'info'),
                            })
                          }
                        }}
                      />
                      <Label htmlFor='level-info' className='font-normal text-sm'>
                        Info
                      </Label>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id='level-error'
                        checked={newWebhook.levelFilter.includes('error')}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setNewWebhook({
                              ...newWebhook,
                              levelFilter: [...newWebhook.levelFilter, 'error'],
                            })
                          } else {
                            setNewWebhook({
                              ...newWebhook,
                              levelFilter: newWebhook.levelFilter.filter((l) => l !== 'error'),
                            })
                          }
                        }}
                      />
                      <Label htmlFor='level-error' className='font-normal text-sm'>
                        Error
                      </Label>
                    </div>
                  </div>
                </div>

                <div className='space-y-3'>
                  <Label>Filter by Trigger</Label>
                  <div className='grid grid-cols-3 gap-3'>
                    {(
                      ['api', 'webhook', 'schedule', 'manual', 'chat'] as NotificationTrigger[]
                    ).map((trigger) => (
                      <div key={trigger} className='flex items-center gap-2'>
                        <Checkbox
                          id={`trigger-${trigger}`}
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
                          }}
                        />
                        <Label
                          htmlFor={`trigger-${trigger}`}
                          className='font-normal text-sm capitalize'
                        >
                          {trigger}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className='space-y-3'>
                  <Label>Include in Payload</Label>
                  <div className='space-y-2'>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id='include-output'
                        checked={newWebhook.includeFinalOutput}
                        onCheckedChange={(checked) =>
                          setNewWebhook({ ...newWebhook, includeFinalOutput: !!checked })
                        }
                      />
                      <Label htmlFor='include-output' className='font-normal text-sm'>
                        Final output
                      </Label>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id='include-spans'
                        checked={newWebhook.includeTraceSpans}
                        onCheckedChange={(checked) =>
                          setNewWebhook({ ...newWebhook, includeTraceSpans: !!checked })
                        }
                      />
                      <Label htmlFor='include-spans' className='font-normal text-sm'>
                        Trace spans (detailed execution steps)
                      </Label>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id='include-rate-limits'
                        checked={newWebhook.includeRateLimits}
                        onCheckedChange={(checked) =>
                          setNewWebhook({ ...newWebhook, includeRateLimits: !!checked })
                        }
                      />
                      <Label htmlFor='include-rate-limits' className='font-normal text-sm'>
                        Rate limits (workflow execution limits)
                      </Label>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        id='include-usage-data'
                        checked={newWebhook.includeUsageData}
                        onCheckedChange={(checked) =>
                          setNewWebhook({ ...newWebhook, includeUsageData: !!checked })
                        }
                      />
                      <Label htmlFor='include-usage-data' className='font-normal text-sm'>
                        Usage data (billing period cost and limits)
                      </Label>
                    </div>
                  </div>
                  <p className='mt-1 text-muted-foreground text-xs'>
                    By default, only basic metadata and cost information is included
                  </p>
                </div>
              </div>
            </div>

            <div className='flex-shrink-0 border-t bg-background p-4'>
              {editingWebhookId && (
                <Button
                  variant='outline'
                  onClick={cancelEdit}
                  disabled={isCreating}
                  className='mr-2'
                >
                  Cancel
                </Button>
              )}
              <Button
                onClick={editingWebhookId ? updateWebhook : createWebhook}
                disabled={
                  isCreating ||
                  !newWebhook.url ||
                  newWebhook.levelFilter.length === 0 ||
                  newWebhook.triggerFilter.length === 0
                }
                className={editingWebhookId ? '' : 'w-full'}
              >
                {isCreating ? (
                  <>
                    <RefreshCw className='mr-2 h-4 w-4 animate-spin' />
                    {editingWebhookId ? 'Updating...' : 'Creating...'}
                  </>
                ) : (
                  <>
                    {editingWebhookId ? (
                      <>
                        <Edit2 className='mr-2 h-4 w-4' />
                        Update Webhook
                      </>
                    ) : (
                      <>
                        <Plus className='mr-2 h-4 w-4' />
                        Create Webhook
                      </>
                    )}
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
