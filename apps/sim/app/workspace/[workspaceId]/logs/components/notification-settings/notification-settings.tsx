'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Bell,
  Check,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react'
import {
  Button as EmcnButton,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
} from '@/components/emcn'
import {
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
import { cn } from '@/lib/utils'
import { useConnectOAuthService } from '@/hooks/queries/oauth-connections'
import { useSlackAccounts } from '@/hooks/use-slack-accounts'
import { SlackChannelSelector } from './slack-channel-selector'
import { WorkflowSelector } from './workflow-selector'

const logger = createLogger('NotificationSettings')

type NotificationType = 'webhook' | 'email' | 'slack'
type LogLevel = 'info' | 'error'
type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
type AlertRule = 'consecutive_failures' | 'failure_rate'

interface AlertConfig {
  rule: AlertRule
  consecutiveFailures?: number
  failureRatePercent?: number
  windowHours?: number
}

interface NotificationSubscription {
  id: string
  notificationType: NotificationType
  workflowIds: string[]
  allWorkflows: boolean
  levelFilter: LogLevel[]
  triggerFilter: TriggerType[]
  includeFinalOutput: boolean
  includeTraceSpans: boolean
  includeRateLimits: boolean
  includeUsageData: boolean
  webhookUrl?: string | null
  emailRecipients?: string[] | null
  slackChannelId?: string | null
  slackAccountId?: string | null
  alertConfig?: AlertConfig | null
  active: boolean
  createdAt: string
  updatedAt: string
}

interface NotificationSettingsProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NOTIFICATION_TYPES: { type: NotificationType; label: string; icon: typeof Webhook }[] = [
  { type: 'webhook', label: 'Webhook', icon: Webhook },
  { type: 'email', label: 'Email', icon: Mail },
  { type: 'slack', label: 'Slack', icon: MessageSquare },
]

const LOG_LEVELS: LogLevel[] = ['info', 'error']
const TRIGGER_TYPES: TriggerType[] = ['api', 'webhook', 'schedule', 'manual', 'chat']

export function NotificationSettings({
  workspaceId,
  open,
  onOpenChange,
}: NotificationSettingsProps) {
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<NotificationType>('webhook')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [testStatus, setTestStatus] = useState<{
    id: string
    success: boolean
    message: string
  } | null>(null)

  const [formData, setFormData] = useState({
    workflowIds: [] as string[],
    allWorkflows: false,
    levelFilter: ['info', 'error'] as LogLevel[],
    triggerFilter: ['api', 'webhook', 'schedule', 'manual', 'chat'] as TriggerType[],
    includeFinalOutput: false,
    includeTraceSpans: false,
    includeRateLimits: false,
    includeUsageData: false,
    webhookUrl: '',
    webhookSecret: '',
    emailRecipients: '',
    slackChannelId: '',
    slackAccountId: '',
    useAlertRule: false,
    alertRule: 'consecutive_failures' as AlertRule,
    consecutiveFailures: 3,
    failureRatePercent: 50,
    windowHours: 24,
  })

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const {
    accounts: slackAccounts,
    isLoading: isLoadingSlackAccounts,
    refetch: refetchSlackAccounts,
  } = useSlackAccounts()
  const connectSlack = useConnectOAuthService()

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((s) => s.notificationType === activeTab)
  }, [subscriptions, activeTab])

  const loadSubscriptions = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/workspaces/${workspaceId}/notifications`)
      if (response.ok) {
        const data = await response.json()
        setSubscriptions(data.data || [])
      }
    } catch (error) {
      logger.error('Failed to load notifications', { error })
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (open) {
      loadSubscriptions()
    }
  }, [open, loadSubscriptions])

  const resetForm = useCallback(() => {
    setFormData({
      workflowIds: [],
      allWorkflows: false,
      levelFilter: ['info', 'error'],
      triggerFilter: ['api', 'webhook', 'schedule', 'manual', 'chat'],
      includeFinalOutput: false,
      includeTraceSpans: false,
      includeRateLimits: false,
      includeUsageData: false,
      webhookUrl: '',
      webhookSecret: '',
      emailRecipients: '',
      slackChannelId: '',
      slackAccountId: '',
      useAlertRule: false,
      alertRule: 'consecutive_failures',
      consecutiveFailures: 3,
      failureRatePercent: 50,
      windowHours: 24,
    })
    setFormErrors({})
    setEditingId(null)
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    setShowForm(false)
    setTestStatus(null)
    onOpenChange(false)
  }, [onOpenChange, resetForm])

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    if (!formData.allWorkflows && formData.workflowIds.length === 0) {
      errors.workflows = 'Select at least one workflow or enable "All Workflows"'
    }

    if (formData.levelFilter.length === 0) {
      errors.levelFilter = 'Select at least one log level'
    }

    if (formData.triggerFilter.length === 0) {
      errors.triggerFilter = 'Select at least one trigger type'
    }

    if (activeTab === 'webhook') {
      if (!formData.webhookUrl) {
        errors.webhookUrl = 'Webhook URL is required'
      } else {
        try {
          const url = new URL(formData.webhookUrl)
          if (!['http:', 'https:'].includes(url.protocol)) {
            errors.webhookUrl = 'URL must start with http:// or https://'
          }
        } catch {
          errors.webhookUrl = 'Invalid URL format'
        }
      }
    }

    if (activeTab === 'email') {
      const emails = formData.emailRecipients
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      if (emails.length === 0) {
        errors.emailRecipients = 'At least one email address is required'
      } else if (emails.length > 10) {
        errors.emailRecipients = 'Maximum 10 email recipients allowed'
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const invalidEmails = emails.filter((e) => !emailRegex.test(e))
        if (invalidEmails.length > 0) {
          errors.emailRecipients = `Invalid email addresses: ${invalidEmails.join(', ')}`
        }
      }
    }

    if (activeTab === 'slack') {
      if (!formData.slackAccountId) {
        errors.slackAccountId = 'Select a Slack account'
      }
      if (!formData.slackChannelId) {
        errors.slackChannelId = 'Select a Slack channel'
      }
    }

    if (formData.useAlertRule) {
      if (formData.alertRule === 'consecutive_failures') {
        if (formData.consecutiveFailures < 1 || formData.consecutiveFailures > 100) {
          errors.consecutiveFailures = 'Must be between 1 and 100'
        }
      } else if (formData.alertRule === 'failure_rate') {
        if (formData.failureRatePercent < 1 || formData.failureRatePercent > 100) {
          errors.failureRatePercent = 'Must be between 1 and 100'
        }
        if (formData.windowHours < 1 || formData.windowHours > 168) {
          errors.windowHours = 'Must be between 1 and 168 hours'
        }
      }
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return

    setIsSaving(true)
    try {
      const alertConfig: AlertConfig | null = formData.useAlertRule
        ? {
            rule: formData.alertRule,
            ...(formData.alertRule === 'consecutive_failures' && {
              consecutiveFailures: formData.consecutiveFailures,
            }),
            ...(formData.alertRule === 'failure_rate' && {
              failureRatePercent: formData.failureRatePercent,
              windowHours: formData.windowHours,
            }),
          }
        : null

      const payload = {
        notificationType: activeTab,
        workflowIds: formData.workflowIds,
        allWorkflows: formData.allWorkflows,
        levelFilter: formData.levelFilter,
        triggerFilter: formData.triggerFilter,
        includeFinalOutput: formData.includeFinalOutput,
        includeTraceSpans: formData.includeTraceSpans,
        includeRateLimits: formData.includeRateLimits,
        includeUsageData: formData.includeUsageData,
        alertConfig,
        ...(activeTab === 'webhook' && {
          webhookUrl: formData.webhookUrl,
          webhookSecret: formData.webhookSecret || undefined,
        }),
        ...(activeTab === 'email' && {
          emailRecipients: formData.emailRecipients
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean),
        }),
        ...(activeTab === 'slack' && {
          slackChannelId: formData.slackChannelId,
          slackAccountId: formData.slackAccountId,
        }),
      }

      const url = editingId
        ? `/api/workspaces/${workspaceId}/notifications/${editingId}`
        : `/api/workspaces/${workspaceId}/notifications`
      const method = editingId ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        await loadSubscriptions()
        resetForm()
        setShowForm(false)
      } else {
        const error = await response.json()
        setFormErrors({ general: error.error || 'Failed to save notification' })
      }
    } catch (error) {
      logger.error('Failed to save notification', { error })
      setFormErrors({ general: 'Failed to save notification' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (subscription: NotificationSubscription) => {
    setActiveTab(subscription.notificationType)
    setEditingId(subscription.id)
    setFormData({
      workflowIds: subscription.workflowIds || [],
      allWorkflows: subscription.allWorkflows,
      levelFilter: subscription.levelFilter as LogLevel[],
      triggerFilter: subscription.triggerFilter as TriggerType[],
      includeFinalOutput: subscription.includeFinalOutput,
      includeTraceSpans: subscription.includeTraceSpans,
      includeRateLimits: subscription.includeRateLimits,
      includeUsageData: subscription.includeUsageData,
      webhookUrl: subscription.webhookUrl || '',
      webhookSecret: '',
      emailRecipients: subscription.emailRecipients?.join(', ') || '',
      slackChannelId: subscription.slackChannelId || '',
      slackAccountId: subscription.slackAccountId || '',
      useAlertRule: !!subscription.alertConfig,
      alertRule: subscription.alertConfig?.rule || 'consecutive_failures',
      consecutiveFailures: subscription.alertConfig?.consecutiveFailures || 3,
      failureRatePercent: subscription.alertConfig?.failureRatePercent || 50,
      windowHours: subscription.alertConfig?.windowHours || 24,
    })
    setShowForm(true)
  }

  const handleDelete = async () => {
    if (!deletingId) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/notifications/${deletingId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadSubscriptions()
      }
    } catch (error) {
      logger.error('Failed to delete notification', { error })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
      setDeletingId(null)
    }
  }

  const handleTest = async (id: string) => {
    setIsTesting(id)
    setTestStatus(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/notifications/${id}/test`, {
        method: 'POST',
      })
      const data = await response.json()
      setTestStatus({
        id,
        success: data.data?.success ?? false,
        message:
          data.data?.error || (data.data?.success ? 'Test sent successfully' : 'Test failed'),
      })
    } catch (error) {
      setTestStatus({ id, success: false, message: 'Failed to send test' })
    } finally {
      setIsTesting(null)
    }
  }

  const handleToggleActive = async (subscription: NotificationSubscription) => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/notifications/${subscription.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !subscription.active }),
      })
      await loadSubscriptions()
    } catch (error) {
      logger.error('Failed to toggle notification', { error })
    }
  }

  const renderSubscriptionItem = (subscription: NotificationSubscription) => {
    const identifier =
      subscription.notificationType === 'webhook'
        ? subscription.webhookUrl
        : subscription.notificationType === 'email'
          ? subscription.emailRecipients?.join(', ')
          : `Channel: ${subscription.slackChannelId}`

    return (
      <div key={subscription.id} className='mb-4 flex flex-col gap-2'>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex flex-1 items-center gap-3'>
            <div className='flex h-8 max-w-[400px] items-center overflow-hidden rounded-[8px] bg-muted px-3'>
              <code className='scrollbar-hide overflow-x-auto whitespace-nowrap font-mono text-foreground text-xs'>
                {identifier}
              </code>
            </div>
            {testStatus?.id === subscription.id && (
              <div
                className={cn(
                  'flex items-center gap-2 text-xs',
                  testStatus.success ? 'text-green-600' : 'text-red-600'
                )}
              >
                {testStatus.success ? (
                  <Check className='h-3 w-3' />
                ) : (
                  <AlertCircle className='h-3 w-3' />
                )}
                <span>{testStatus.message}</span>
              </div>
            )}
          </div>

          <div className='flex items-center gap-2'>
            <Switch
              checked={subscription.active}
              onCheckedChange={() => handleToggleActive(subscription)}
            />
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => handleTest(subscription.id)}
                  disabled={isTesting === subscription.id}
                  className='h-8 w-8'
                >
                  <Play className='h-3.5 w-3.5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Test notification</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => handleEdit(subscription)}
                  className='h-8 w-8'
                >
                  <Pencil className='h-3.5 w-3.5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Edit</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => {
                    setDeletingId(subscription.id)
                    setShowDeleteDialog(true)
                  }}
                  className='h-8 w-8'
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Delete</Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2 text-xs'>
          {subscription.allWorkflows ? (
            <span className='rounded-md bg-muted px-1.5 py-0.5'>All workflows</span>
          ) : (
            <span className='rounded-md bg-muted px-1.5 py-0.5'>
              {subscription.workflowIds.length} workflow(s)
            </span>
          )}
          <span className='text-muted-foreground'>•</span>
          {subscription.levelFilter.map((level) => (
            <span key={level} className='rounded-md bg-muted px-1.5 py-0.5'>
              {level}
            </span>
          ))}
          <span className='text-muted-foreground'>•</span>
          {subscription.triggerFilter.slice(0, 3).map((trigger) => (
            <span key={trigger} className='rounded-md bg-muted px-1.5 py-0.5'>
              {trigger}
            </span>
          ))}
          {subscription.triggerFilter.length > 3 && (
            <span className='rounded-md bg-muted px-1.5 py-0.5'>
              +{subscription.triggerFilter.length - 3}
            </span>
          )}
          {subscription.alertConfig && (
            <>
              <span className='text-muted-foreground'>•</span>
              <span className='rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'>
                {subscription.alertConfig.rule === 'consecutive_failures'
                  ? `${subscription.alertConfig.consecutiveFailures} consecutive failures`
                  : `${subscription.alertConfig.failureRatePercent}% failure rate in ${subscription.alertConfig.windowHours}h`}
              </span>
            </>
          )}
        </div>
      </div>
    )
  }

  const renderForm = () => (
    <div className='flex flex-col gap-6 pt-1'>
      <div>
        <h3 className='font-medium text-base'>
          {editingId ? 'Edit Notification' : 'Create New Notification'}
        </h3>
        <p className='text-muted-foreground text-sm'>
          Configure {activeTab} notifications for workflow executions
        </p>
      </div>

      {formErrors.general && (
        <div className='rounded-[8px] border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-950/20'>
          <div className='flex items-start gap-2'>
            <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />
            <p className='text-red-800 text-sm dark:text-red-300'>{formErrors.general}</p>
          </div>
        </div>
      )}

      <div className='flex flex-col gap-6'>
        <WorkflowSelector
          workspaceId={workspaceId}
          selectedIds={formData.workflowIds}
          allWorkflows={formData.allWorkflows}
          onChange={(ids, all) => {
            setFormData({ ...formData, workflowIds: ids, allWorkflows: all })
            setFormErrors({ ...formErrors, workflows: '' })
          }}
          error={formErrors.workflows}
        />

        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='flex flex-col'>
              <Label className='font-medium text-sm'>Alert Mode</Label>
              <p className='text-muted-foreground text-xs'>
                {formData.useAlertRule
                  ? 'Notify when failure patterns are detected'
                  : 'Notify on every matching execution'}
              </p>
            </div>
            <Switch
              checked={formData.useAlertRule}
              onCheckedChange={(checked) => setFormData({ ...formData, useAlertRule: checked })}
            />
          </div>

          {formData.useAlertRule && (
            <div className='space-y-4 rounded-lg border bg-muted/30 p-4'>
              <div className='space-y-2'>
                <Label className='font-medium text-sm'>Alert Rule</Label>
                <select
                  value={formData.alertRule}
                  onChange={(e) =>
                    setFormData({ ...formData, alertRule: e.target.value as AlertRule })
                  }
                  className='h-9 w-full rounded-[8px] border bg-background px-3 text-sm'
                >
                  <option value='consecutive_failures'>Consecutive Failures</option>
                  <option value='failure_rate'>Failure Rate</option>
                </select>
              </div>

              {formData.alertRule === 'consecutive_failures' && (
                <div className='space-y-2'>
                  <Label className='font-medium text-sm'>Consecutive Failures Threshold</Label>
                  <Input
                    type='number'
                    min={1}
                    max={100}
                    value={formData.consecutiveFailures}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        consecutiveFailures: Number.parseInt(e.target.value) || 1,
                      })
                    }
                    className='h-9 w-32 rounded-[8px]'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Alert after this many consecutive failed executions
                  </p>
                  {formErrors.consecutiveFailures && (
                    <p className='text-red-400 text-xs'>{formErrors.consecutiveFailures}</p>
                  )}
                </div>
              )}

              {formData.alertRule === 'failure_rate' && (
                <>
                  <div className='space-y-2'>
                    <Label className='font-medium text-sm'>Failure Rate Threshold (%)</Label>
                    <Input
                      type='number'
                      min={1}
                      max={100}
                      value={formData.failureRatePercent}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          failureRatePercent: Number.parseInt(e.target.value) || 1,
                        })
                      }
                      className='h-9 w-32 rounded-[8px]'
                    />
                    <p className='text-muted-foreground text-xs'>
                      Alert when failure rate exceeds this percentage
                    </p>
                    {formErrors.failureRatePercent && (
                      <p className='text-red-400 text-xs'>{formErrors.failureRatePercent}</p>
                    )}
                  </div>
                  <div className='space-y-2'>
                    <Label className='font-medium text-sm'>Time Window (hours)</Label>
                    <Input
                      type='number'
                      min={1}
                      max={168}
                      value={formData.windowHours}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          windowHours: Number.parseInt(e.target.value) || 1,
                        })
                      }
                      className='h-9 w-32 rounded-[8px]'
                    />
                    <p className='text-muted-foreground text-xs'>
                      Calculate failure rate over this sliding window (max 168 hours / 7 days)
                    </p>
                    {formErrors.windowHours && (
                      <p className='text-red-400 text-xs'>{formErrors.windowHours}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {activeTab === 'webhook' && (
          <>
            <div className='space-y-2'>
              <Label className='font-medium text-sm'>Webhook URL</Label>
              <Input
                type='url'
                placeholder='https://your-app.com/webhook'
                value={formData.webhookUrl}
                onChange={(e) => {
                  setFormData({ ...formData, webhookUrl: e.target.value })
                  setFormErrors({ ...formErrors, webhookUrl: '' })
                }}
                className='h-9 rounded-[8px]'
              />
              {formErrors.webhookUrl && (
                <p className='text-red-400 text-xs'>{formErrors.webhookUrl}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label className='font-medium text-sm'>Secret (optional)</Label>
              <Input
                type='password'
                placeholder='Webhook secret for signature verification'
                value={formData.webhookSecret}
                onChange={(e) => setFormData({ ...formData, webhookSecret: e.target.value })}
                className='h-9 rounded-[8px]'
              />
              <p className='text-muted-foreground text-xs'>
                Used to sign webhook payloads with HMAC-SHA256
              </p>
            </div>
          </>
        )}

        {activeTab === 'email' && (
          <div className='space-y-2'>
            <Label className='font-medium text-sm'>Email Recipients</Label>
            <Input
              type='text'
              placeholder='email@example.com, another@example.com'
              value={formData.emailRecipients}
              onChange={(e) => {
                setFormData({ ...formData, emailRecipients: e.target.value })
                setFormErrors({ ...formErrors, emailRecipients: '' })
              }}
              className='h-9 rounded-[8px]'
            />
            <p className='text-muted-foreground text-xs'>
              Comma-separated list of email addresses (max 10)
            </p>
            {formErrors.emailRecipients && (
              <p className='text-red-400 text-xs'>{formErrors.emailRecipients}</p>
            )}
          </div>
        )}

        {activeTab === 'slack' && (
          <>
            <div className='space-y-2'>
              <Label className='font-medium text-sm'>Slack Account</Label>
              {isLoadingSlackAccounts ? (
                <Skeleton className='h-9 w-full rounded-[8px]' />
              ) : slackAccounts.length === 0 ? (
                <div className='rounded-[8px] border border-dashed p-4 text-center'>
                  <p className='text-muted-foreground text-sm'>No Slack accounts connected</p>
                  <Button
                    variant='outline'
                    size='sm'
                    className='mt-2'
                    onClick={async () => {
                      await connectSlack.mutateAsync({
                        providerId: 'slack',
                        callbackURL: window.location.href,
                      })
                    }}
                    disabled={connectSlack.isPending}
                  >
                    {connectSlack.isPending ? 'Connecting...' : 'Connect Slack'}
                  </Button>
                </div>
              ) : (
                <select
                  value={formData.slackAccountId}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      slackAccountId: e.target.value,
                      slackChannelId: '',
                    })
                    setFormErrors({ ...formErrors, slackAccountId: '', slackChannelId: '' })
                  }}
                  className='h-9 w-full rounded-[8px] border bg-background px-3 text-sm'
                >
                  <option value=''>Select account...</option>
                  {slackAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountId}
                    </option>
                  ))}
                </select>
              )}
              {formErrors.slackAccountId && (
                <p className='text-red-400 text-xs'>{formErrors.slackAccountId}</p>
              )}
            </div>
            {slackAccounts.length > 0 && (
              <div className='space-y-2'>
                <Label className='font-medium text-sm'>Channel</Label>
                <SlackChannelSelector
                  accountId={formData.slackAccountId}
                  value={formData.slackChannelId}
                  onChange={(channelId) => {
                    setFormData({ ...formData, slackChannelId: channelId })
                    setFormErrors({ ...formErrors, slackChannelId: '' })
                  }}
                  disabled={!formData.slackAccountId}
                  error={formErrors.slackChannelId}
                />
              </div>
            )}
          </>
        )}

        <div className='space-y-3'>
          <Label className='font-medium text-sm'>Log Level Filters</Label>
          <div className='space-y-3'>
            {LOG_LEVELS.map((level) => (
              <div key={level} className='flex items-center justify-between'>
                <div className='flex flex-col'>
                  <Label className='font-normal text-sm capitalize'>{level} logs</Label>
                  <p className='text-muted-foreground text-xs'>
                    Receive notifications for {level} level logs
                  </p>
                </div>
                <Switch
                  checked={formData.levelFilter.includes(level)}
                  onCheckedChange={(checked) => {
                    const updated = checked
                      ? [...formData.levelFilter, level]
                      : formData.levelFilter.filter((l) => l !== level)
                    setFormData({ ...formData, levelFilter: updated })
                    setFormErrors({ ...formErrors, levelFilter: '' })
                  }}
                />
              </div>
            ))}
          </div>
          {formErrors.levelFilter && (
            <p className='text-red-400 text-xs'>{formErrors.levelFilter}</p>
          )}
        </div>

        <div className='space-y-3'>
          <Label className='font-medium text-sm'>Trigger Type Filters</Label>
          <div className='space-y-3'>
            {TRIGGER_TYPES.map((trigger) => (
              <div key={trigger} className='flex items-center justify-between'>
                <div className='flex flex-col'>
                  <Label className='font-normal text-sm capitalize'>{trigger} triggers</Label>
                  <p className='text-muted-foreground text-xs'>
                    Notify when workflow is triggered via {trigger}
                  </p>
                </div>
                <Switch
                  checked={formData.triggerFilter.includes(trigger)}
                  onCheckedChange={(checked) => {
                    const updated = checked
                      ? [...formData.triggerFilter, trigger]
                      : formData.triggerFilter.filter((t) => t !== trigger)
                    setFormData({ ...formData, triggerFilter: updated })
                    setFormErrors({ ...formErrors, triggerFilter: '' })
                  }}
                />
              </div>
            ))}
          </div>
          {formErrors.triggerFilter && (
            <p className='text-red-400 text-xs'>{formErrors.triggerFilter}</p>
          )}
        </div>

        <div className='space-y-3'>
          <Label className='font-medium text-sm'>Include in Payload</Label>
          <div className='flex flex-col gap-3'>
            {[
              {
                key: 'includeFinalOutput',
                label: 'Final output',
                desc: 'Include workflow execution results',
              },
              { key: 'includeTraceSpans', label: 'Trace spans', desc: 'Detailed execution steps' },
              { key: 'includeRateLimits', label: 'Rate limits', desc: 'Workflow execution limits' },
              {
                key: 'includeUsageData',
                label: 'Usage data',
                desc: 'Billing period cost and limits',
              },
            ].map(({ key, label, desc }) => (
              <div key={key} className='flex items-center justify-between'>
                <div className='flex flex-col'>
                  <Label className='font-normal text-sm'>{label}</Label>
                  <p className='text-muted-foreground text-xs'>{desc}</p>
                </div>
                <Switch
                  checked={formData[key as keyof typeof formData] as boolean}
                  onCheckedChange={(checked) => setFormData({ ...formData, [key]: checked })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className='flex h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[800px]'>
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <DialogTitle className='flex items-center gap-2 font-medium text-lg'>
            <Bell className='h-5 w-5' />
            Notification Settings
          </DialogTitle>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col'>
          {!showForm && (
            <div className='flex flex-shrink-0 items-center justify-between border-b px-6 py-3'>
              <div className='flex gap-1'>
                {NOTIFICATION_TYPES.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => setActiveTab(type)}
                    className={cn(
                      'flex items-center gap-2 rounded-[8px] px-3 py-1.5 font-medium text-sm transition-colors',
                      activeTab === type
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    <Icon className='h-4 w-4' />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className='min-h-0 flex-1 overflow-y-auto px-6'>
            <div className='h-full py-4'>
              {showForm ? (
                renderForm()
              ) : isLoading ? (
                <div className='space-y-4'>
                  {[1, 2].map((i) => (
                    <div key={i} className='flex flex-col gap-2'>
                      <Skeleton className='h-8 w-[300px] rounded-[8px]' />
                      <Skeleton className='h-6 w-[200px] rounded-[8px]' />
                    </div>
                  ))}
                </div>
              ) : filteredSubscriptions.length === 0 ? (
                <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
                  No {activeTab} notifications configured
                </div>
              ) : (
                <div>{filteredSubscriptions.map(renderSubscriptionItem)}</div>
              )}
            </div>
          </div>
        </div>

        <div className='flex-shrink-0 bg-background'>
          <div className='flex w-full items-center justify-between border-t px-6 py-4'>
            {showForm ? (
              <>
                <Button
                  variant='outline'
                  onClick={() => {
                    resetForm()
                    setShowForm(false)
                  }}
                  className='h-9 rounded-[8px]'
                >
                  Back
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className='h-9 rounded-[8px] bg-[var(--brand-primary-hex)] font-[480] text-white hover:bg-[var(--brand-primary-hover-hex)]'
                >
                  {isSaving
                    ? editingId
                      ? 'Updating...'
                      : 'Creating...'
                    : editingId
                      ? 'Update'
                      : 'Create'}
                </Button>
              </>
            ) : isLoading ? (
              <>
                <Skeleton className='h-9 w-[120px] rounded-[8px]' />
                <div />
              </>
            ) : (
              <>
                <Button
                  onClick={() => {
                    resetForm()
                    setShowForm(true)
                  }}
                  className='h-9 rounded-[8px] bg-[var(--brand-primary-hex)] px-3 font-[480] text-white hover:bg-[var(--brand-primary-hover-hex)]'
                >
                  <Plus className='h-4 w-4' />
                  Add {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                </Button>
                <div />
              </>
            )}
          </div>
        </div>
      </DialogContent>

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete notification?</ModalTitle>
            <ModalDescription>
              This will permanently remove the notification and stop all deliveries.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <EmcnButton
              variant='outline'
              className='h-[32px] px-[12px]'
              disabled={isDeleting}
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </EmcnButton>
            <EmcnButton
              onClick={handleDelete}
              disabled={isDeleting}
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)]'
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </EmcnButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Dialog>
  )
}
