'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, X } from 'lucide-react'
import {
  Badge,
  Button,
  Combobox,
  Input as EmcnInput,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { SlackIcon } from '@/components/icons'
import { Skeleton } from '@/components/ui'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import {
  type NotificationSubscription,
  useCreateNotification,
  useDeleteNotification,
  useNotifications,
  useTestNotification,
  useUpdateNotification,
} from '@/hooks/queries/notifications'
import { useConnectedAccounts, useConnectOAuthService } from '@/hooks/queries/oauth-connections'
import { CORE_TRIGGER_TYPES, type CoreTriggerType } from '@/stores/logs/filters/types'
import { SlackChannelSelector } from './components/slack-channel-selector'
import { WorkflowSelector } from './components/workflow-selector'

const logger = createLogger('NotificationSettings')

type NotificationType = 'webhook' | 'email' | 'slack'
type LogLevel = 'info' | 'error'
type AlertRule =
  | 'none'
  | 'consecutive_failures'
  | 'failure_rate'
  | 'latency_threshold'
  | 'latency_spike'
  | 'cost_threshold'
  | 'no_activity'
  | 'error_count'

const ALERT_RULES: { value: AlertRule; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Notify on every matching execution' },
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
    allWorkflows: true,
    levelFilter: ['info', 'error'] as LogLevel[],
    triggerFilter: [...CORE_TRIGGER_TYPES] as CoreTriggerType[],
    includeFinalOutput: false,
    includeTraceSpans: false,
    includeRateLimits: false,
    includeUsageData: false,
    webhookUrl: '',
    webhookSecret: '',
    emailRecipients: [] as string[],
    slackChannelId: '',
    slackChannelName: '',
    slackAccountId: '',
    useAlertRule: false,
    alertRule: 'none' as AlertRule,
    consecutiveFailures: 3,
    failureRatePercent: 50,
    windowHours: 24,
    durationThresholdMs: 30000,
    latencySpikePercent: 100,
    costThresholdDollars: 1,
    inactivityHours: 24,
    errorCountThreshold: 10,
  })

  const [emailItems, setEmailItems] = useState<TagItem[]>([])

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const { data: subscriptions = [], isLoading } = useNotifications(open ? workspaceId : undefined)
  const createNotification = useCreateNotification()
  const updateNotification = useUpdateNotification()
  const deleteNotification = useDeleteNotification()
  const testNotification = useTestNotification()

  const { data: slackAccounts = [], isLoading: isLoadingSlackAccounts } =
    useConnectedAccounts('slack')
  const connectSlack = useConnectOAuthService()

  useEffect(() => {
    if (testStatus) {
      const timer = setTimeout(() => {
        setTestStatus(null)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [testStatus])

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((s) => s.notificationType === activeTab)
  }, [subscriptions, activeTab])

  const hasSubscriptions = filteredSubscriptions.length > 0

  // Compute form visibility synchronously to avoid empty state flash
  // Show form if user explicitly opened it OR if loading is complete with no subscriptions
  const displayForm = showForm || (!isLoading && !hasSubscriptions && !editingId)

  const getSubscriptionsForTab = useCallback(
    (tab: NotificationType) => {
      return subscriptions.filter((s) => s.notificationType === tab)
    },
    [subscriptions]
  )

  const resetForm = useCallback(() => {
    setFormData({
      workflowIds: [],
      allWorkflows: true,
      levelFilter: ['info', 'error'],
      triggerFilter: [...CORE_TRIGGER_TYPES],
      includeFinalOutput: false,
      includeTraceSpans: false,
      includeRateLimits: false,
      includeUsageData: false,
      webhookUrl: '',
      webhookSecret: '',
      emailRecipients: [],
      slackChannelId: '',
      slackChannelName: '',
      slackAccountId: '',
      useAlertRule: false,
      alertRule: 'none',
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
    setEmailItems([])
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    setShowForm(false)
    setTestStatus(null)
    onOpenChange(false)
  }, [onOpenChange, resetForm])

  const addEmail = useCallback(
    (email: string): boolean => {
      if (!email.trim()) return false

      const normalized = email.trim().toLowerCase()
      const validation = quickValidateEmail(normalized)

      if (emailItems.some((item) => item.value === normalized)) {
        return false
      }

      setEmailItems((prev) => [...prev, { value: normalized, isValid: validation.isValid }])

      if (validation.isValid) {
        setFormErrors((prev) => ({ ...prev, emailRecipients: '' }))
        setFormData((prev) => ({
          ...prev,
          emailRecipients: [...prev.emailRecipients, normalized],
        }))
      }

      return validation.isValid
    },
    [emailItems]
  )

  const handleRemoveEmailItem = useCallback(
    (_value: string, index: number, isValid: boolean) => {
      const itemToRemove = emailItems[index]
      setEmailItems((prev) => prev.filter((_, i) => i !== index))
      if (isValid && itemToRemove) {
        setFormData((prev) => ({
          ...prev,
          emailRecipients: prev.emailRecipients.filter((e) => e !== itemToRemove.value),
        }))
      }
    },
    [emailItems]
  )

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
      if (formData.emailRecipients.length === 0) {
        errors.emailRecipients = 'At least one email address is required'
      } else if (formData.emailRecipients.length > 10) {
        errors.emailRecipients = 'Maximum 10 email recipients allowed'
      }
      const invalidEmailValues = emailItems
        .filter((item) => !item.isValid)
        .map((item) => item.value)
      if (invalidEmailValues.length > 0) {
        errors.emailRecipients = `Invalid email addresses: ${invalidEmailValues.join(', ')}`
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

    if (formData.alertRule !== 'none') {
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

    const alertConfig =
      formData.alertRule !== 'none'
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
      // Trace spans only available for webhooks (too large for email/Slack)
      includeTraceSpans: activeTab === 'webhook' ? formData.includeTraceSpans : false,
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
        emailRecipients: formData.emailRecipients,
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
      triggerFilter: subscription.triggerFilter as CoreTriggerType[],
      includeFinalOutput: subscription.includeFinalOutput,
      includeTraceSpans: subscription.includeTraceSpans,
      includeRateLimits: subscription.includeRateLimits,
      includeUsageData: subscription.includeUsageData,
      webhookUrl: subscription.webhookConfig?.url || '',
      webhookSecret: '',
      emailRecipients: subscription.emailRecipients || [],
      slackChannelId: subscription.slackConfig?.channelId || '',
      slackChannelName: subscription.slackConfig?.channelName || '',
      slackAccountId: subscription.slackConfig?.accountId || '',
      useAlertRule: !!subscription.alertConfig,
      alertRule: subscription.alertConfig?.rule || 'none',
      consecutiveFailures: subscription.alertConfig?.consecutiveFailures || 3,
      failureRatePercent: subscription.alertConfig?.failureRatePercent || 50,
      windowHours: subscription.alertConfig?.windowHours || 24,
      durationThresholdMs: subscription.alertConfig?.durationThresholdMs || 30000,
      latencySpikePercent: subscription.alertConfig?.latencySpikePercent || 100,
      costThresholdDollars: subscription.alertConfig?.costThresholdDollars || 1,
      inactivityHours: subscription.alertConfig?.inactivityHours || 24,
      errorCountThreshold: subscription.alertConfig?.errorCountThreshold || 10,
    })
    setEmailItems(
      (subscription.emailRecipients || []).map((email) => ({ value: email, isValid: true }))
    )
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
    } catch (_error) {
      setTestStatus({ id, success: false, message: 'Failed to send test' })
    }
  }

  const renderSubscriptionItem = (subscription: NotificationSubscription) => {
    const identifier =
      subscription.notificationType === 'webhook'
        ? subscription.webhookConfig?.url
        : subscription.notificationType === 'email'
          ? subscription.emailRecipients?.join(', ')
          : `#${subscription.slackConfig?.channelName || subscription.slackConfig?.channelId}`

    return (
      <div key={subscription.id} className='rounded-[6px] border p-[10px]'>
        <div className='flex items-center justify-between gap-[12px]'>
          <div className='flex min-w-0 flex-1 flex-col gap-[6px]'>
            <p className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
              {identifier}
            </p>
            <div className='flex flex-wrap items-center gap-[6px] text-[11px]'>
              {subscription.allWorkflows ? (
                <Badge className='rounded-[4px] px-[6px] py-[2px] text-[11px]'>All workflows</Badge>
              ) : (
                <Badge className='rounded-[4px] px-[6px] py-[2px] text-[11px]'>
                  {subscription.workflowIds.length} workflow(s)
                </Badge>
              )}
              {subscription.levelFilter.map((level) => (
                <Badge key={level} className='rounded-[4px] px-[6px] py-[2px] text-[11px]'>
                  {level}
                </Badge>
              ))}
              {subscription.alertConfig && (
                <Badge className='rounded-[4px] bg-amber-100 px-[6px] py-[2px] text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'>
                  {formatAlertConfigLabel(subscription.alertConfig)}
                </Badge>
              )}
            </div>
          </div>

          <div className='flex flex-shrink-0 items-center gap-[8px]'>
            <Button
              variant='tertiary'
              onClick={() => handleTest(subscription.id)}
              disabled={testNotification.isPending && testStatus?.id !== subscription.id}
            >
              {testStatus?.id === subscription.id
                ? testStatus.success
                  ? 'Sent'
                  : 'Failed'
                : 'Test'}
            </Button>
            <Button variant='ghost' onClick={() => handleEdit(subscription)}>
              Edit
            </Button>
            <Button
              variant='ghost'
              onClick={() => {
                setDeletingId(subscription.id)
                setShowDeleteDialog(true)
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const renderForm = () => (
    <div className='flex h-full flex-col gap-[16px]'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {formErrors.general && (
          <p className='mb-[16px] text-[12px] text-[var(--text-error)]'>{formErrors.general}</p>
        )}

        <div className='flex flex-col gap-[16px]'>
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

          {activeTab === 'webhook' && (
            <>
              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Webhook URL</Label>
                <EmcnInput
                  type='url'
                  placeholder='https://your-app.com/webhook'
                  value={formData.webhookUrl}
                  onChange={(e) => {
                    setFormData({ ...formData, webhookUrl: e.target.value })
                    setFormErrors({ ...formErrors, webhookUrl: '' })
                  }}
                />
                {formErrors.webhookUrl && (
                  <p className='text-[12px] text-[var(--text-error)]'>{formErrors.webhookUrl}</p>
                )}
              </div>
              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Secret (optional)</Label>
                <EmcnInput
                  type='password'
                  placeholder='Webhook secret for signature verification'
                  value={formData.webhookSecret}
                  onChange={(e) => setFormData({ ...formData, webhookSecret: e.target.value })}
                />
              </div>
            </>
          )}

          {activeTab === 'email' && (
            <div className='flex flex-col gap-[8px]'>
              <Label className='text-[var(--text-secondary)]'>Email Recipients</Label>
              <TagInput
                items={emailItems}
                onAdd={(value) => addEmail(value)}
                onRemove={handleRemoveEmailItem}
                placeholder='Enter emails'
                placeholderWithTags='Add email'
              />
              {formErrors.emailRecipients && (
                <p className='text-[12px] text-[var(--text-error)]'>{formErrors.emailRecipients}</p>
              )}
            </div>
          )}

          {activeTab === 'slack' && (
            <>
              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Slack Account</Label>
                {isLoadingSlackAccounts ? (
                  <Skeleton className='h-[34px] w-full rounded-[6px]' />
                ) : slackAccounts.length === 0 ? (
                  <div className='flex'>
                    <Button
                      variant='active'
                      onClick={async () => {
                        await connectSlack.mutateAsync({
                          providerId: 'slack',
                          callbackURL: window.location.href,
                        })
                      }}
                      disabled={connectSlack.isPending}
                      className='flex items-center gap-[8px]'
                    >
                      <SlackIcon className='h-[11px] w-[11px]' />
                      {connectSlack.isPending ? 'Connecting...' : 'Connect Slack'}
                    </Button>
                  </div>
                ) : (
                  <Combobox
                    options={slackAccounts.map((acc) => ({
                      value: acc.id,
                      label: acc.displayName || 'Slack Workspace',
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
                  <p className='text-[12px] text-[var(--text-error)]'>
                    {formErrors.slackAccountId}
                  </p>
                )}
              </div>
              {slackAccounts.length > 0 && (
                <div className='flex flex-col gap-[8px]'>
                  <Label className='text-[var(--text-secondary)]'>Channel</Label>
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

          <div className='flex flex-col gap-[8px]'>
            <Label className='text-[var(--text-secondary)]'>Log Level Filters</Label>
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
                  <div className='flex items-center gap-[4px]'>
                    {formData.levelFilter.map((level) => (
                      <Badge
                        key={level}
                        variant='outline'
                        className='pointer-events-auto cursor-pointer gap-[4px] rounded-[6px] px-[8px] py-[2px] text-[11px] capitalize'
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
                      </Badge>
                    ))}
                  </div>
                ) : null
              }
              showAllOption
              allOptionLabel='All levels'
            />
            {formErrors.levelFilter && (
              <p className='text-[12px] text-[var(--text-error)]'>{formErrors.levelFilter}</p>
            )}
          </div>

          <div className='flex flex-col gap-[8px]'>
            <Label className='text-[var(--text-secondary)]'>Trigger Type Filters</Label>
            <Combobox
              options={CORE_TRIGGER_TYPES.map((trigger) => ({
                label: trigger.charAt(0).toUpperCase() + trigger.slice(1),
                value: trigger,
              }))}
              multiSelect
              multiSelectValues={formData.triggerFilter}
              onMultiSelectChange={(values) => {
                setFormData({ ...formData, triggerFilter: values as CoreTriggerType[] })
                setFormErrors({ ...formErrors, triggerFilter: '' })
              }}
              placeholder='Select trigger types...'
              overlayContent={
                formData.triggerFilter.length > 0 ? (
                  <div className='flex items-center gap-[4px] overflow-hidden'>
                    {formData.triggerFilter.map((trigger) => (
                      <Badge
                        key={trigger}
                        variant='outline'
                        className='pointer-events-auto cursor-pointer gap-[4px] rounded-[6px] px-[8px] py-[2px] text-[11px] capitalize'
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
                      </Badge>
                    ))}
                  </div>
                ) : null
              }
              showAllOption
              allOptionLabel='All triggers'
            />
            {formErrors.triggerFilter && (
              <p className='text-[12px] text-[var(--text-error)]'>{formErrors.triggerFilter}</p>
            )}
          </div>

          <div className='flex flex-col gap-[8px]'>
            <Label className='text-[var(--text-secondary)]'>Include in Payload</Label>
            <Combobox
              options={[
                { label: 'Final Output', value: 'includeFinalOutput' },
                // Trace spans only available for webhooks (too large for email/Slack)
                ...(activeTab === 'webhook'
                  ? [{ label: 'Trace Spans', value: 'includeTraceSpans' }]
                  : []),
                { label: 'Rate Limits', value: 'includeRateLimits' },
                { label: 'Usage Data', value: 'includeUsageData' },
              ]}
              multiSelect
              multiSelectValues={
                [
                  formData.includeFinalOutput && 'includeFinalOutput',
                  formData.includeTraceSpans && activeTab === 'webhook' && 'includeTraceSpans',
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
                  formData.includeTraceSpans && activeTab === 'webhook' && 'includeTraceSpans',
                  formData.includeRateLimits && 'includeRateLimits',
                  formData.includeUsageData && 'includeUsageData',
                ].filter(Boolean) as string[]

                if (selected.length === 0) return null

                return (
                  <div className='flex items-center gap-[4px] overflow-hidden'>
                    {selected.slice(0, 2).map((key) => (
                      <Badge
                        key={key}
                        variant='outline'
                        className='pointer-events-auto cursor-pointer gap-[4px] rounded-[6px] px-[8px] py-[2px] text-[11px]'
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setFormData({ ...formData, [key]: false })
                        }}
                      >
                        {labels[key]}
                        <X className='h-3 w-3' />
                      </Badge>
                    ))}
                    {selected.length > 2 && (
                      <Badge
                        variant='outline'
                        className='rounded-[6px] px-[8px] py-[2px] text-[11px]'
                      >
                        +{selected.length - 2}
                      </Badge>
                    )}
                  </div>
                )
              })()}
              showAllOption
              allOptionLabel='None'
            />
          </div>

          <div className='flex flex-col gap-[8px]'>
            <Label className='text-[var(--text-secondary)]'>Rule</Label>
            <Combobox
              options={ALERT_RULES.map((rule) => ({
                value: rule.value,
                label: rule.label,
              }))}
              value={formData.alertRule}
              onChange={(value) => setFormData({ ...formData, alertRule: value as AlertRule })}
              placeholder='Select rule'
            />
            <p className='text-[12px] text-[var(--text-muted)]'>
              {ALERT_RULES.find((r) => r.value === formData.alertRule)?.description}
            </p>
          </div>

          {formData.alertRule === 'consecutive_failures' && (
            <div className='flex flex-col gap-[8px]'>
              <Label className='text-[var(--text-secondary)]'>Failure Count</Label>
              <EmcnInput
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
              />
              {formErrors.consecutiveFailures && (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {formErrors.consecutiveFailures}
                </p>
              )}
            </div>
          )}

          {formData.alertRule === 'failure_rate' && (
            <div className='flex gap-[8px]'>
              <div className='flex flex-1 flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Failure Rate (%)</Label>
                <EmcnInput
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
                  <p className='text-[12px] text-[var(--text-error)]'>
                    {formErrors.failureRatePercent}
                  </p>
                )}
              </div>
              <div className='flex flex-1 flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Window (hours)</Label>
                <EmcnInput
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
                  <p className='text-[12px] text-[var(--text-error)]'>{formErrors.windowHours}</p>
                )}
              </div>
            </div>
          )}

          {formData.alertRule === 'latency_threshold' && (
            <div className='flex flex-col gap-[8px]'>
              <Label className='text-[var(--text-secondary)]'>Duration Threshold (seconds)</Label>
              <EmcnInput
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
              />
              {formErrors.durationThresholdMs && (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {formErrors.durationThresholdMs}
                </p>
              )}
            </div>
          )}

          {formData.alertRule === 'latency_spike' && (
            <div className='flex gap-[8px]'>
              <div className='flex flex-1 flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Above Average (%)</Label>
                <EmcnInput
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
                  <p className='text-[12px] text-[var(--text-error)]'>
                    {formErrors.latencySpikePercent}
                  </p>
                )}
              </div>
              <div className='flex flex-1 flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Window (hours)</Label>
                <EmcnInput
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
                  <p className='text-[12px] text-[var(--text-error)]'>{formErrors.windowHours}</p>
                )}
              </div>
            </div>
          )}

          {formData.alertRule === 'cost_threshold' && (
            <div className='flex flex-col gap-[8px]'>
              <Label className='text-[var(--text-secondary)]'>Cost Threshold ($)</Label>
              <EmcnInput
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
              />
              {formErrors.costThresholdDollars && (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {formErrors.costThresholdDollars}
                </p>
              )}
            </div>
          )}

          {formData.alertRule === 'no_activity' && (
            <div className='flex flex-col gap-[8px]'>
              <Label className='text-[var(--text-secondary)]'>Inactivity Period (hours)</Label>
              <EmcnInput
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
              />
              {formErrors.inactivityHours && (
                <p className='text-[12px] text-[var(--text-error)]'>{formErrors.inactivityHours}</p>
              )}
            </div>
          )}

          {formData.alertRule === 'error_count' && (
            <div className='flex gap-[8px]'>
              <div className='flex flex-1 flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Error Count</Label>
                <EmcnInput
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
                  <p className='text-[12px] text-[var(--text-error)]'>
                    {formErrors.errorCountThreshold}
                  </p>
                )}
              </div>
              <div className='flex flex-1 flex-col gap-[8px]'>
                <Label className='text-[var(--text-secondary)]'>Window (hours)</Label>
                <EmcnInput
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
                  <p className='text-[12px] text-[var(--text-error)]'>{formErrors.windowHours}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const renderTabContent = () => {
    if (displayForm) {
      return renderForm()
    }

    return (
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              {[1, 2].map((i) => (
                <div key={i} className='rounded-[6px] border p-[10px]'>
                  <div className='flex items-center justify-between gap-[12px]'>
                    <div className='flex min-w-0 flex-1 flex-col gap-[6px]'>
                      <Skeleton className='h-[16px] w-[200px]' />
                      <div className='flex items-center gap-[6px]'>
                        <Skeleton className='h-[18px] w-[80px] rounded-[4px]' />
                        <Skeleton className='h-[18px] w-[50px] rounded-[4px]' />
                      </div>
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-[8px]'>
                      <Skeleton className='h-[30px] w-[40px] rounded-[4px]' />
                      <Skeleton className='h-[30px] w-[40px] rounded-[4px]' />
                      <Skeleton className='h-[30px] w-[54px] rounded-[4px]' />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredSubscriptions.map(renderSubscriptionItem)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <Modal open={open} onOpenChange={handleClose}>
        <ModalContent size='lg'>
          <ModalHeader>Notifications</ModalHeader>

          <ModalTabs
            value={activeTab}
            onValueChange={(value: string) => {
              const newTab = value as NotificationType
              const tabHasSubscriptions = getSubscriptionsForTab(newTab).length > 0
              resetForm()
              setActiveTab(newTab)
              setShowForm(!tabHasSubscriptions)
            }}
            className='flex min-h-0 flex-1 flex-col'
          >
            <ModalTabsList activeValue={activeTab}>
              <ModalTabsTrigger value='webhook'>Webhook</ModalTabsTrigger>
              <ModalTabsTrigger value='email'>Email</ModalTabsTrigger>
              <ModalTabsTrigger value='slack'>Slack</ModalTabsTrigger>
            </ModalTabsList>

            <ModalBody className='min-h-0 flex-1'>
              <ModalTabsContent value='webhook'>{renderTabContent()}</ModalTabsContent>
              <ModalTabsContent value='email'>{renderTabContent()}</ModalTabsContent>
              <ModalTabsContent value='slack'>{renderTabContent()}</ModalTabsContent>
            </ModalBody>
          </ModalTabs>

          <ModalFooter>
            {displayForm ? (
              <>
                {hasSubscriptions && (
                  <Button
                    variant='default'
                    onClick={() => {
                      resetForm()
                      setShowForm(false)
                    }}
                  >
                    Back
                  </Button>
                )}
                <Button
                  variant='tertiary'
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
              </>
            ) : (
              <Button
                onClick={() => {
                  resetForm()
                  setShowForm(true)
                }}
                variant='tertiary'
                disabled={isLoading}
              >
                <Plus className='mr-[6px] h-[13px] w-[13px]' />
                Add
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Notification</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              This will permanently remove the notification and stop all deliveries.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              disabled={deleteNotification.isPending}
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDelete}
              disabled={deleteNotification.isPending}
            >
              {deleteNotification.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
