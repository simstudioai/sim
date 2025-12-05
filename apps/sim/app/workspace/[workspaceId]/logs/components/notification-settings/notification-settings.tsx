'use client'

import { useCallback, useMemo, useState } from 'react'
import { AlertCircle, Check, Pencil, Play, Trash2, X } from 'lucide-react'
import {
  Button,
  Combobox,
  Input,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Switch,
  Tooltip,
} from '@/components/emcn'
import {
  ModalBody,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
} from '@/components/emcn/components/modal/modal'
import { Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type NotificationSubscription,
  useCreateNotification,
  useDeleteNotification,
  useNotifications,
  useTestNotification,
  useToggleNotificationActive,
  useUpdateNotification,
} from '@/hooks/queries/notifications'
import { useConnectOAuthService } from '@/hooks/queries/oauth-connections'
import { useSlackAccounts } from '@/hooks/use-slack-accounts'
import { SlackChannelSelector } from './slack-channel-selector'
import { WorkflowSelector } from './workflow-selector'

const logger = createLogger('NotificationSettings')

type NotificationType = 'webhook' | 'email' | 'slack'
type LogLevel = 'info' | 'error'
type TriggerType = 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
type AlertRule =
  | 'consecutive_failures'
  | 'failure_rate'
  | 'latency_threshold'
  | 'latency_spike'
  | 'cost_threshold'
  | 'no_activity'
  | 'error_count'

const ALERT_RULES: { value: AlertRule; label: string; description: string }[] = [
  {
    value: 'consecutive_failures',
    label: 'Consecutive Failures',
    description: 'After X failures in a row',
  },
  { value: 'failure_rate', label: 'Failure Rate', description: 'When failure % exceeds threshold' },
  {
    value: 'latency_threshold',
    label: 'Latency Threshold',
    description: 'When execution exceeds duration',
  },
  { value: 'latency_spike', label: 'Latency Spike', description: 'When slower than average by %' },
  {
    value: 'cost_threshold',
    label: 'Cost Threshold',
    description: 'When execution cost exceeds $',
  },
  { value: 'no_activity', label: 'No Activity', description: 'When no executions in time window' },
  { value: 'error_count', label: 'Error Count', description: 'When errors exceed count in window' },
]

interface NotificationSettingsProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const LOG_LEVELS: LogLevel[] = ['info', 'error']
const TRIGGER_TYPES: TriggerType[] = ['api', 'webhook', 'schedule', 'manual', 'chat']

function formatAlertConfigLabel(config: {
  rule: AlertRule
  consecutiveFailures?: number
  failureRatePercent?: number
  windowHours?: number
  durationThresholdMs?: number
  latencySpikePercent?: number
  costThresholdDollars?: number
  inactivityHours?: number
  errorCountThreshold?: number
}): string {
  switch (config.rule) {
    case 'consecutive_failures':
      return `${config.consecutiveFailures} consecutive failures`
    case 'failure_rate':
      return `${config.failureRatePercent}% failure rate in ${config.windowHours}h`
    case 'latency_threshold':
      return `>${Math.round((config.durationThresholdMs || 0) / 1000)}s duration`
    case 'latency_spike':
      return `${config.latencySpikePercent}% above avg in ${config.windowHours}h`
    case 'cost_threshold':
      return `>$${config.costThresholdDollars} per execution`
    case 'no_activity':
      return `No activity in ${config.inactivityHours}h`
    case 'error_count':
      return `${config.errorCountThreshold} errors in ${config.windowHours}h`
    default:
      return 'Alert rule'
  }
}

export function NotificationSettings({
  workspaceId,
  open,
  onOpenChange,
}: NotificationSettingsProps) {
  const [activeTab, setActiveTab] = useState<NotificationType>('webhook')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
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
    slackChannelName: '',
    slackAccountId: '',
    useAlertRule: false,
    alertRule: 'consecutive_failures' as AlertRule,
    consecutiveFailures: 3,
    failureRatePercent: 50,
    windowHours: 24,
    durationThresholdMs: 30000,
    latencySpikePercent: 100,
    costThresholdDollars: 1,
    inactivityHours: 24,
    errorCountThreshold: 10,
  })

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const { data: subscriptions = [], isLoading } = useNotifications(open ? workspaceId : undefined)
  const createNotification = useCreateNotification()
  const updateNotification = useUpdateNotification()
  const toggleActive = useToggleNotificationActive()
  const deleteNotification = useDeleteNotification()
  const testNotification = useTestNotification()

  const { accounts: slackAccounts, isLoading: isLoadingSlackAccounts } = useSlackAccounts()
  const connectSlack = useConnectOAuthService()

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((s) => s.notificationType === activeTab)
  }, [subscriptions, activeTab])

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
      slackChannelName: '',
      slackAccountId: '',
      useAlertRule: false,
      alertRule: 'consecutive_failures',
      consecutiveFailures: 3,
      failureRatePercent: 50,
      windowHours: 24,
      durationThresholdMs: 30000,
      latencySpikePercent: 100,
      costThresholdDollars: 1,
      inactivityHours: 24,
      errorCountThreshold: 10,
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
      switch (formData.alertRule) {
        case 'consecutive_failures':
          if (formData.consecutiveFailures < 1 || formData.consecutiveFailures > 100) {
            errors.consecutiveFailures = 'Must be between 1 and 100'
          }
          break
        case 'failure_rate':
          if (formData.failureRatePercent < 1 || formData.failureRatePercent > 100) {
            errors.failureRatePercent = 'Must be between 1 and 100'
          }
          if (formData.windowHours < 1 || formData.windowHours > 168) {
            errors.windowHours = 'Must be between 1 and 168 hours'
          }
          break
        case 'latency_threshold':
          if (formData.durationThresholdMs < 1000 || formData.durationThresholdMs > 3600000) {
            errors.durationThresholdMs = 'Must be between 1s and 1 hour'
          }
          break
        case 'latency_spike':
          if (formData.latencySpikePercent < 10 || formData.latencySpikePercent > 1000) {
            errors.latencySpikePercent = 'Must be between 10% and 1000%'
          }
          if (formData.windowHours < 1 || formData.windowHours > 168) {
            errors.windowHours = 'Must be between 1 and 168 hours'
          }
          break
        case 'cost_threshold':
          if (formData.costThresholdDollars < 0.01 || formData.costThresholdDollars > 1000) {
            errors.costThresholdDollars = 'Must be between $0.01 and $1000'
          }
          break
        case 'no_activity':
          if (formData.inactivityHours < 1 || formData.inactivityHours > 168) {
            errors.inactivityHours = 'Must be between 1 and 168 hours'
          }
          break
        case 'error_count':
          if (formData.errorCountThreshold < 1 || formData.errorCountThreshold > 1000) {
            errors.errorCountThreshold = 'Must be between 1 and 1000'
          }
          if (formData.windowHours < 1 || formData.windowHours > 168) {
            errors.windowHours = 'Must be between 1 and 168 hours'
          }
          break
      }
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return

    const alertConfig = formData.useAlertRule
      ? {
          rule: formData.alertRule,
          ...(formData.alertRule === 'consecutive_failures' && {
            consecutiveFailures: formData.consecutiveFailures,
          }),
          ...(formData.alertRule === 'failure_rate' && {
            failureRatePercent: formData.failureRatePercent,
            windowHours: formData.windowHours,
          }),
          ...(formData.alertRule === 'latency_threshold' && {
            durationThresholdMs: formData.durationThresholdMs,
          }),
          ...(formData.alertRule === 'latency_spike' && {
            latencySpikePercent: formData.latencySpikePercent,
            windowHours: formData.windowHours,
          }),
          ...(formData.alertRule === 'cost_threshold' && {
            costThresholdDollars: formData.costThresholdDollars,
          }),
          ...(formData.alertRule === 'no_activity' && {
            inactivityHours: formData.inactivityHours,
          }),
          ...(formData.alertRule === 'error_count' && {
            errorCountThreshold: formData.errorCountThreshold,
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
        webhookConfig: {
          url: formData.webhookUrl,
          secret: formData.webhookSecret || undefined,
        },
      }),
      ...(activeTab === 'email' && {
        emailRecipients: formData.emailRecipients
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean),
      }),
      ...(activeTab === 'slack' && {
        slackConfig: {
          channelId: formData.slackChannelId,
          channelName: formData.slackChannelName,
          accountId: formData.slackAccountId,
        },
      }),
    }

    try {
      if (editingId) {
        await updateNotification.mutateAsync({
          workspaceId,
          notificationId: editingId,
          data: payload,
        })
      } else {
        await createNotification.mutateAsync({
          workspaceId,
          data: payload,
        })
      }
      resetForm()
      setShowForm(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save notification'
      setFormErrors({ general: message })
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
      webhookUrl: subscription.webhookConfig?.url || '',
      webhookSecret: '',
      emailRecipients: subscription.emailRecipients?.join(', ') || '',
      slackChannelId: subscription.slackConfig?.channelId || '',
      slackChannelName: subscription.slackConfig?.channelName || '',
      slackAccountId: subscription.slackConfig?.accountId || '',
      useAlertRule: !!subscription.alertConfig,
      alertRule: subscription.alertConfig?.rule || 'consecutive_failures',
      consecutiveFailures: subscription.alertConfig?.consecutiveFailures || 3,
      failureRatePercent: subscription.alertConfig?.failureRatePercent || 50,
      windowHours: subscription.alertConfig?.windowHours || 24,
      durationThresholdMs: subscription.alertConfig?.durationThresholdMs || 30000,
      latencySpikePercent: subscription.alertConfig?.latencySpikePercent || 100,
      costThresholdDollars: subscription.alertConfig?.costThresholdDollars || 1,
      inactivityHours: subscription.alertConfig?.inactivityHours || 24,
      errorCountThreshold: subscription.alertConfig?.errorCountThreshold || 10,
    })
    setShowForm(true)
  }

  const handleDelete = async () => {
    if (!deletingId) return

    try {
      await deleteNotification.mutateAsync({
        workspaceId,
        notificationId: deletingId,
      })
    } catch (error) {
      logger.error('Failed to delete notification', { error })
    } finally {
      setShowDeleteDialog(false)
      setDeletingId(null)
    }
  }

  const handleTest = async (id: string) => {
    setTestStatus(null)
    try {
      const result = await testNotification.mutateAsync({
        workspaceId,
        notificationId: id,
      })
      setTestStatus({
        id,
        success: result.data?.success ?? false,
        message:
          result.data?.error || (result.data?.success ? 'Test sent successfully' : 'Test failed'),
      })
    } catch (error) {
      setTestStatus({ id, success: false, message: 'Failed to send test' })
    }
  }

  const handleToggleActive = (subscription: NotificationSubscription) => {
    toggleActive.mutate({
      workspaceId,
      notificationId: subscription.id,
      active: !subscription.active,
    })
  }

  const renderSubscriptionItem = (subscription: NotificationSubscription) => {
    const identifier =
      subscription.notificationType === 'webhook'
        ? subscription.webhookConfig?.url
        : subscription.notificationType === 'email'
          ? subscription.emailRecipients?.join(', ')
          : `#${subscription.slackConfig?.channelName || subscription.slackConfig?.channelId}`

    return (
      <div key={subscription.id} className='mb-4 flex flex-col gap-2'>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex flex-1 items-center gap-3'>
            <div className='flex h-8 max-w-[400px] items-center overflow-hidden rounded-[4px] bg-[var(--surface-6)] px-3'>
              <code className='scrollbar-hide overflow-x-auto whitespace-nowrap font-mono text-[var(--text-primary)] text-xs'>
                {identifier}
              </code>
            </div>
            {testStatus?.id === subscription.id && (
              <div
                className={`flex items-center gap-2 text-xs ${testStatus.success ? 'text-green-600' : 'text-red-600'}`}
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
                  onClick={() => handleTest(subscription.id)}
                  disabled={testNotification.isPending}
                  className='h-8 w-8 p-0'
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
                  onClick={() => handleEdit(subscription)}
                  className='h-8 w-8 p-0'
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
                  onClick={() => {
                    setDeletingId(subscription.id)
                    setShowDeleteDialog(true)
                  }}
                  className='h-8 w-8 p-0'
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
            <span className='rounded-[4px] bg-[var(--surface-6)] px-1.5 py-0.5'>All workflows</span>
          ) : (
            <span className='rounded-[4px] bg-[var(--surface-6)] px-1.5 py-0.5'>
              {subscription.workflowIds.length} workflow(s)
            </span>
          )}
          <span className='text-[var(--text-muted)]'>•</span>
          {subscription.levelFilter.map((level) => (
            <span key={level} className='rounded-[4px] bg-[var(--surface-6)] px-1.5 py-0.5'>
              {level}
            </span>
          ))}
          <span className='text-[var(--text-muted)]'>•</span>
          {subscription.triggerFilter.slice(0, 3).map((trigger) => (
            <span key={trigger} className='rounded-[4px] bg-[var(--surface-6)] px-1.5 py-0.5'>
              {trigger}
            </span>
          ))}
          {subscription.triggerFilter.length > 3 && (
            <span className='rounded-[4px] bg-[var(--surface-6)] px-1.5 py-0.5'>
              +{subscription.triggerFilter.length - 3}
            </span>
          )}
          {subscription.alertConfig && (
            <>
              <span className='text-[var(--text-muted)]'>•</span>
              <span className='rounded-[4px] bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'>
                {formatAlertConfigLabel(subscription.alertConfig)}
              </span>
            </>
          )}
        </div>
      </div>
    )
  }

  const renderForm = () => (
    <div className='flex flex-col gap-6'>
      <div>
        <p className='font-medium text-[14px] text-[var(--text-primary)]'>
          {editingId ? 'Edit Notification' : 'Create New Notification'}
        </p>
        <p className='text-[12px] text-[var(--text-muted)]'>
          Configure {activeTab} notifications for workflow executions
        </p>
      </div>

      {formErrors.general && (
        <div className='rounded-[4px] border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-950/20'>
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
              <Label>Alert Mode</Label>
              <p className='text-[12px] text-[var(--text-muted)]'>
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
            <div className='space-y-4 rounded-[4px] border bg-[var(--surface-2)] p-4'>
              <div className='space-y-2'>
                <Label>Alert Rule</Label>
                <Combobox
                  options={ALERT_RULES.map((rule) => ({
                    value: rule.value,
                    label: rule.label,
                  }))}
                  value={formData.alertRule}
                  onChange={(value) => setFormData({ ...formData, alertRule: value as AlertRule })}
                  placeholder='Select alert rule'
                />
                <p className='text-[12px] text-[var(--text-muted)]'>
                  {ALERT_RULES.find((r) => r.value === formData.alertRule)?.description}
                </p>
              </div>

              {formData.alertRule === 'consecutive_failures' && (
                <div className='space-y-2'>
                  <Label>Failure Count</Label>
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
                    className='w-32'
                  />
                  {formErrors.consecutiveFailures && (
                    <p className='text-red-400 text-xs'>{formErrors.consecutiveFailures}</p>
                  )}
                </div>
              )}

              {formData.alertRule === 'failure_rate' && (
                <div className='flex gap-4'>
                  <div className='flex-1 space-y-2'>
                    <Label>Failure Rate (%)</Label>
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
                    />
                    {formErrors.failureRatePercent && (
                      <p className='text-red-400 text-xs'>{formErrors.failureRatePercent}</p>
                    )}
                  </div>
                  <div className='flex-1 space-y-2'>
                    <Label>Window (hours)</Label>
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
                    />
                    {formErrors.windowHours && (
                      <p className='text-red-400 text-xs'>{formErrors.windowHours}</p>
                    )}
                  </div>
                </div>
              )}

              {formData.alertRule === 'latency_threshold' && (
                <div className='space-y-2'>
                  <Label>Duration Threshold (seconds)</Label>
                  <Input
                    type='number'
                    min={1}
                    max={3600}
                    value={Math.round(formData.durationThresholdMs / 1000)}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        durationThresholdMs: (Number.parseInt(e.target.value) || 1) * 1000,
                      })
                    }
                    className='w-32'
                  />
                  {formErrors.durationThresholdMs && (
                    <p className='text-red-400 text-xs'>{formErrors.durationThresholdMs}</p>
                  )}
                </div>
              )}

              {formData.alertRule === 'latency_spike' && (
                <div className='flex gap-4'>
                  <div className='flex-1 space-y-2'>
                    <Label>Above Average (%)</Label>
                    <Input
                      type='number'
                      min={10}
                      max={1000}
                      value={formData.latencySpikePercent}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          latencySpikePercent: Number.parseInt(e.target.value) || 10,
                        })
                      }
                    />
                    {formErrors.latencySpikePercent && (
                      <p className='text-red-400 text-xs'>{formErrors.latencySpikePercent}</p>
                    )}
                  </div>
                  <div className='flex-1 space-y-2'>
                    <Label>Window (hours)</Label>
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
                    />
                    {formErrors.windowHours && (
                      <p className='text-red-400 text-xs'>{formErrors.windowHours}</p>
                    )}
                  </div>
                </div>
              )}

              {formData.alertRule === 'cost_threshold' && (
                <div className='space-y-2'>
                  <Label>Cost Threshold ($)</Label>
                  <Input
                    type='number'
                    min={0.01}
                    max={1000}
                    step={0.01}
                    value={formData.costThresholdDollars}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        costThresholdDollars: Number.parseFloat(e.target.value) || 0.01,
                      })
                    }
                    className='w-32'
                  />
                  {formErrors.costThresholdDollars && (
                    <p className='text-red-400 text-xs'>{formErrors.costThresholdDollars}</p>
                  )}
                </div>
              )}

              {formData.alertRule === 'no_activity' && (
                <div className='space-y-2'>
                  <Label>Inactivity Period (hours)</Label>
                  <Input
                    type='number'
                    min={1}
                    max={168}
                    value={formData.inactivityHours}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        inactivityHours: Number.parseInt(e.target.value) || 1,
                      })
                    }
                    className='w-32'
                  />
                  {formErrors.inactivityHours && (
                    <p className='text-red-400 text-xs'>{formErrors.inactivityHours}</p>
                  )}
                </div>
              )}

              {formData.alertRule === 'error_count' && (
                <div className='flex gap-4'>
                  <div className='flex-1 space-y-2'>
                    <Label>Error Count</Label>
                    <Input
                      type='number'
                      min={1}
                      max={1000}
                      value={formData.errorCountThreshold}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          errorCountThreshold: Number.parseInt(e.target.value) || 1,
                        })
                      }
                    />
                    {formErrors.errorCountThreshold && (
                      <p className='text-red-400 text-xs'>{formErrors.errorCountThreshold}</p>
                    )}
                  </div>
                  <div className='flex-1 space-y-2'>
                    <Label>Window (hours)</Label>
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
                    />
                    {formErrors.windowHours && (
                      <p className='text-red-400 text-xs'>{formErrors.windowHours}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {activeTab === 'webhook' && (
          <>
            <div className='space-y-2'>
              <Label>Webhook URL</Label>
              <Input
                type='url'
                placeholder='https://your-app.com/webhook'
                value={formData.webhookUrl}
                onChange={(e) => {
                  setFormData({ ...formData, webhookUrl: e.target.value })
                  setFormErrors({ ...formErrors, webhookUrl: '' })
                }}
              />
              {formErrors.webhookUrl && (
                <p className='text-red-400 text-xs'>{formErrors.webhookUrl}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label>Secret (optional)</Label>
              <Input
                type='password'
                placeholder='Webhook secret for signature verification'
                value={formData.webhookSecret}
                onChange={(e) => setFormData({ ...formData, webhookSecret: e.target.value })}
              />
              <p className='text-[12px] text-[var(--text-muted)]'>
                Used to sign webhook payloads with HMAC-SHA256
              </p>
            </div>
          </>
        )}

        {activeTab === 'email' && (
          <div className='space-y-2'>
            <Label>Email Recipients</Label>
            <Input
              type='text'
              placeholder='email@example.com, another@example.com'
              value={formData.emailRecipients}
              onChange={(e) => {
                setFormData({ ...formData, emailRecipients: e.target.value })
                setFormErrors({ ...formErrors, emailRecipients: '' })
              }}
            />
            <p className='text-[12px] text-[var(--text-muted)]'>
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
              <Label>Slack Account</Label>
              {isLoadingSlackAccounts ? (
                <Skeleton className='h-9 w-full' />
              ) : slackAccounts.length === 0 ? (
                <div className='rounded-[4px] border border-dashed p-4 text-center'>
                  <p className='text-[12px] text-[var(--text-muted)]'>
                    No Slack accounts connected
                  </p>
                  <Button
                    variant='outline'
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
                <Combobox
                  options={slackAccounts.map((acc) => ({
                    value: acc.id,
                    label: acc.accountId,
                  }))}
                  value={formData.slackAccountId}
                  onChange={(value) => {
                    setFormData({
                      ...formData,
                      slackAccountId: value,
                      slackChannelId: '',
                    })
                    setFormErrors({ ...formErrors, slackAccountId: '', slackChannelId: '' })
                  }}
                  placeholder='Select account...'
                />
              )}
              {formErrors.slackAccountId && (
                <p className='text-red-400 text-xs'>{formErrors.slackAccountId}</p>
              )}
            </div>
            {slackAccounts.length > 0 && (
              <div className='space-y-2'>
                <Label>Channel</Label>
                <SlackChannelSelector
                  accountId={formData.slackAccountId}
                  value={formData.slackChannelId}
                  onChange={(channelId, channelName) => {
                    setFormData({
                      ...formData,
                      slackChannelId: channelId,
                      slackChannelName: channelName,
                    })
                    setFormErrors({ ...formErrors, slackChannelId: '' })
                  }}
                  disabled={!formData.slackAccountId}
                  error={formErrors.slackChannelId}
                />
              </div>
            )}
          </>
        )}

        <div className='space-y-2'>
          <div>
            <Label>Log Level Filters</Label>
            <p className='text-[12px] text-[var(--text-muted)]'>
              Select which log levels trigger notifications
            </p>
          </div>
          <Combobox
            options={LOG_LEVELS.map((level) => ({
              label: level.charAt(0).toUpperCase() + level.slice(1),
              value: level,
            }))}
            multiSelect
            multiSelectValues={formData.levelFilter}
            onMultiSelectChange={(values) => {
              setFormData({ ...formData, levelFilter: values as LogLevel[] })
              setFormErrors({ ...formErrors, levelFilter: '' })
            }}
            placeholder='Select log levels...'
            overlayContent={
              formData.levelFilter.length > 0 ? (
                <div className='flex items-center gap-1'>
                  {formData.levelFilter.map((level) => (
                    <Button
                      key={level}
                      variant='outline'
                      className='pointer-events-auto h-6 gap-1 rounded-[6px] px-2 text-[11px] capitalize'
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setFormData({
                          ...formData,
                          levelFilter: formData.levelFilter.filter((l) => l !== level),
                        })
                      }}
                    >
                      {level}
                      <X className='h-3 w-3' />
                    </Button>
                  ))}
                </div>
              ) : null
            }
          />
          {formErrors.levelFilter && (
            <p className='text-red-400 text-xs'>{formErrors.levelFilter}</p>
          )}
        </div>

        <div className='space-y-2'>
          <div>
            <Label>Trigger Type Filters</Label>
            <p className='text-[12px] text-[var(--text-muted)]'>
              Select which trigger types send notifications
            </p>
          </div>
          <Combobox
            options={TRIGGER_TYPES.map((trigger) => ({
              label: trigger.charAt(0).toUpperCase() + trigger.slice(1),
              value: trigger,
            }))}
            multiSelect
            multiSelectValues={formData.triggerFilter}
            onMultiSelectChange={(values) => {
              setFormData({ ...formData, triggerFilter: values as TriggerType[] })
              setFormErrors({ ...formErrors, triggerFilter: '' })
            }}
            placeholder='Select trigger types...'
            overlayContent={
              formData.triggerFilter.length > 0 ? (
                <div className='flex items-center gap-1 overflow-hidden'>
                  {formData.triggerFilter.slice(0, 3).map((trigger) => (
                    <Button
                      key={trigger}
                      variant='outline'
                      className='pointer-events-auto h-6 gap-1 rounded-[6px] px-2 text-[11px] capitalize'
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setFormData({
                          ...formData,
                          triggerFilter: formData.triggerFilter.filter((t) => t !== trigger),
                        })
                      }}
                    >
                      {trigger}
                      <X className='h-3 w-3' />
                    </Button>
                  ))}
                  {formData.triggerFilter.length > 3 && (
                    <span className='flex h-6 items-center rounded-[6px] border px-2 text-[11px]'>
                      +{formData.triggerFilter.length - 3}
                    </span>
                  )}
                </div>
              ) : null
            }
          />
          {formErrors.triggerFilter && (
            <p className='text-red-400 text-xs'>{formErrors.triggerFilter}</p>
          )}
        </div>

        <div className='space-y-2'>
          <div>
            <Label>Include in Payload</Label>
            <p className='text-[12px] text-[var(--text-muted)]'>
              Additional data to include in notifications
            </p>
          </div>
          <Combobox
            options={[
              { label: 'Final Output', value: 'includeFinalOutput' },
              { label: 'Trace Spans', value: 'includeTraceSpans' },
              { label: 'Rate Limits', value: 'includeRateLimits' },
              { label: 'Usage Data', value: 'includeUsageData' },
            ]}
            multiSelect
            multiSelectValues={
              [
                formData.includeFinalOutput && 'includeFinalOutput',
                formData.includeTraceSpans && 'includeTraceSpans',
                formData.includeRateLimits && 'includeRateLimits',
                formData.includeUsageData && 'includeUsageData',
              ].filter(Boolean) as string[]
            }
            onMultiSelectChange={(values) => {
              setFormData({
                ...formData,
                includeFinalOutput: values.includes('includeFinalOutput'),
                includeTraceSpans: values.includes('includeTraceSpans'),
                includeRateLimits: values.includes('includeRateLimits'),
                includeUsageData: values.includes('includeUsageData'),
              })
            }}
            placeholder='Select data to include...'
            overlayContent={(() => {
              const labels: Record<string, string> = {
                includeFinalOutput: 'Final Output',
                includeTraceSpans: 'Trace Spans',
                includeRateLimits: 'Rate Limits',
                includeUsageData: 'Usage Data',
              }
              const selected = [
                formData.includeFinalOutput && 'includeFinalOutput',
                formData.includeTraceSpans && 'includeTraceSpans',
                formData.includeRateLimits && 'includeRateLimits',
                formData.includeUsageData && 'includeUsageData',
              ].filter(Boolean) as string[]

              if (selected.length === 0) return null

              return (
                <div className='flex items-center gap-1 overflow-hidden'>
                  {selected.slice(0, 2).map((key) => (
                    <Button
                      key={key}
                      variant='outline'
                      className='pointer-events-auto h-6 gap-1 rounded-[6px] px-2 text-[11px]'
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setFormData({ ...formData, [key]: false })
                      }}
                    >
                      {labels[key]}
                      <X className='h-3 w-3' />
                    </Button>
                  ))}
                  {selected.length > 2 && (
                    <span className='flex h-6 items-center rounded-[6px] border px-2 text-[11px]'>
                      +{selected.length - 2}
                    </span>
                  )}
                </div>
              )
            })()}
          />
        </div>
      </div>
    </div>
  )

  const renderTabContent = () => {
    if (showForm) {
      return renderForm()
    }

    if (isLoading) {
      return (
        <div className='space-y-4'>
          {[1, 2].map((i) => (
            <div key={i} className='flex flex-col gap-2'>
              <Skeleton className='h-8 w-[300px]' />
              <Skeleton className='h-6 w-[200px]' />
            </div>
          ))}
        </div>
      )
    }

    if (filteredSubscriptions.length === 0) {
      return (
        <div className='flex h-full items-center justify-center'>
          <p className='text-[13px] text-[var(--text-muted)]'>
            No {activeTab} notifications configured
          </p>
        </div>
      )
    }

    return <div>{filteredSubscriptions.map(renderSubscriptionItem)}</div>
  }

  return (
    <>
      <Modal open={open} onOpenChange={handleClose}>
        <ModalContent className='h-[70vh] w-[660px]'>
          <ModalHeader>Notifications</ModalHeader>

          <ModalTabs
            value={activeTab}
            onValueChange={(value: string) => {
              if (!showForm) {
                setActiveTab(value as NotificationType)
              }
            }}
            className='flex min-h-0 flex-1 flex-col'
          >
            {!showForm && (
              <ModalTabsList activeValue={activeTab}>
                <ModalTabsTrigger value='webhook'>Webhook</ModalTabsTrigger>
                <ModalTabsTrigger value='email'>Email</ModalTabsTrigger>
                <ModalTabsTrigger value='slack'>Slack</ModalTabsTrigger>
              </ModalTabsList>
            )}

            <ModalBody className='min-h-0 flex-1'>
              <ModalTabsContent value='webhook'>{renderTabContent()}</ModalTabsContent>
              <ModalTabsContent value='email'>{renderTabContent()}</ModalTabsContent>
              <ModalTabsContent value='slack'>{renderTabContent()}</ModalTabsContent>
            </ModalBody>
          </ModalTabs>

          {showForm ? (
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => {
                  resetForm()
                  setShowForm(false)
                }}
              >
                Back
              </Button>
              <Button
                variant='primary'
                onClick={handleSave}
                disabled={createNotification.isPending || updateNotification.isPending}
              >
                {createNotification.isPending || updateNotification.isPending
                  ? editingId
                    ? 'Updating...'
                    : 'Creating...'
                  : editingId
                    ? 'Update'
                    : 'Create'}
              </Button>
            </ModalFooter>
          ) : (
            <ModalFooter>
              <Button
                variant='primary'
                onClick={() => {
                  resetForm()
                  setShowForm(true)
                }}
              >
                Add {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

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
            <Button
              variant='outline'
              className='h-[32px] px-[12px]'
              disabled={deleteNotification.isPending}
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteNotification.isPending}
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)]'
            >
              {deleteNotification.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
