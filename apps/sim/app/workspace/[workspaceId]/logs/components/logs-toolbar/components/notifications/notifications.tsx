'use client'

import type { ReactNode } from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { X } from 'lucide-react'
import {
  Badge,
  Button,
  ChipCombobox,
  ChipConfirmModal,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  Skeleton,
} from '@/components/emcn'
import { SlackIcon } from '@/components/icons'
import type {
  NotificationAlertRule,
  NotificationLogLevel,
  NotificationType,
} from '@/lib/api/contracts/notifications'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getTriggerOptions } from '@/lib/logs/get-trigger-options'
import {
  type NotificationSubscription,
  useCreateNotification,
  useDeleteNotification,
  useNotifications,
  useTestNotification,
  useUpdateNotification,
} from '@/hooks/queries/notifications'
import {
  useConnectedAccounts,
  useConnectOAuthService,
} from '@/hooks/queries/oauth/oauth-connections'
import type { CoreTriggerType } from '@/stores/logs/filters/types'
import { SlackChannelSelector } from './components/slack-channel-selector'
import { WorkflowSelector } from './components/workflow-selector'

const logger = createLogger('NotificationSettings')

interface TabContentProps {
  displayForm: boolean
  renderForm: () => ReactNode
  isLoading: boolean
  filteredSubscriptions: NotificationSubscription[]
  renderSubscriptionItem: (subscription: NotificationSubscription) => ReactNode
}

function TabContent({
  displayForm,
  renderForm,
  isLoading,
  filteredSubscriptions,
  renderSubscriptionItem,
}: TabContentProps) {
  if (displayForm) {
    return renderForm()
  }

  return (
    <div className='flex h-full flex-col gap-4'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {isLoading ? (
          <div className='flex flex-col gap-4'>
            {[120, 80, 100, 90].map((labelWidth, i) => (
              <div key={i} className='flex flex-col gap-2'>
                <Skeleton className='h-[14px] rounded-sm' style={{ width: labelWidth }} />
                <Skeleton className='h-[34px] w-full rounded-md' />
              </div>
            ))}
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {filteredSubscriptions.map(renderSubscriptionItem)}
          </div>
        )}
      </div>
    </div>
  )
}

const TRIGGER_OPTIONS = getTriggerOptions()
const ALL_TRIGGER_VALUES = TRIGGER_OPTIONS.map((t) => t.value)

type LogLevel = NotificationLogLevel
/** Contract alert rule plus a UI-only `'none'` sentinel meaning "no alert config". */
type AlertRule = NotificationAlertRule | 'none'

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
    description: 'When execution cost exceeds credits',
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
      return `>${dollarsToCredits(config.costThresholdDollars ?? 0).toLocaleString()} credits per execution`
    case 'no_activity':
      return `No activity in ${config.inactivityHours}h`
    case 'error_count':
      return `${config.errorCountThreshold} errors in ${config.windowHours}h`
    default:
      return 'Alert rule'
  }
}

export const NotificationSettings = memo(function NotificationSettings({
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
    triggerFilter: ALL_TRIGGER_VALUES,
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

  const getSubscriptionsForTab = (tab: NotificationType) => {
    return subscriptions.filter((s) => s.notificationType === tab)
  }

  const resetForm = useCallback(() => {
    setFormData({
      workflowIds: [],
      allWorkflows: true,
      levelFilter: ['info', 'error'],
      triggerFilter: ALL_TRIGGER_VALUES,
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
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    setShowForm(false)
    setTestStatus(null)
    onOpenChange(false)
  }, [onOpenChange, resetForm])

  const handleEmailRecipientsChange = useCallback((next: string[]) => {
    setFormData((prev) => ({ ...prev, emailRecipients: next }))
    setFormErrors((prev) => ({ ...prev, emailRecipients: '' }))
  }, [])

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
      triggerFilter: formData.triggerFilter as CoreTriggerType[],
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
      const message = getErrorMessage(error, 'Failed to save notification')
      setFormErrors({ general: message })
    }
  }

  const handleBackToList = () => {
    resetForm()
    setShowForm(false)
  }

  const handleAddNew = () => {
    resetForm()
    setShowForm(true)
  }

  const handleEdit = (subscription: NotificationSubscription) => {
    setActiveTab(subscription.notificationType)
    setEditingId(subscription.id)
    setFormData({
      workflowIds: subscription.workflowIds || [],
      allWorkflows: subscription.allWorkflows,
      levelFilter: subscription.levelFilter as LogLevel[],
      triggerFilter: subscription.triggerFilter,
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
      <div key={subscription.id} className='rounded-md border p-2.5'>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
            <p className='truncate font-medium text-[var(--text-primary)] text-small'>
              {identifier}
            </p>
            <div className='flex flex-wrap items-center gap-1.5 text-xs'>
              {subscription.allWorkflows ? (
                <Badge className='rounded-sm px-1.5 py-0.5 text-xs'>All workflows</Badge>
              ) : (
                <Badge className='rounded-sm px-1.5 py-0.5 text-xs'>
                  {subscription.workflowIds.length} workflow(s)
                </Badge>
              )}
              {subscription.levelFilter.map((level) => (
                <Badge key={level} className='rounded-sm px-1.5 py-0.5 text-xs'>
                  {level}
                </Badge>
              ))}
              {subscription.alertConfig && (
                <Badge className='rounded-sm bg-amber-100 px-1.5 py-0.5 text-amber-800 text-xs dark:bg-amber-900/30 dark:text-amber-400'>
                  {formatAlertConfigLabel(subscription.alertConfig)}
                </Badge>
              )}
            </div>
          </div>

          <div className='flex flex-shrink-0 items-center gap-2'>
            <Button
              variant='primary'
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
    <div className='flex h-full flex-col gap-4'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {formErrors.general && (
          <p className='mb-4 text-[var(--text-error)] text-caption'>{formErrors.general}</p>
        )}

        <div className='flex flex-col gap-4'>
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
              <ChipModalField
                flush
                type='input'
                inputType='url'
                title='Webhook URL'
                placeholder='https://your-app.com/webhook'
                autoComplete='off'
                value={formData.webhookUrl}
                onChange={(value) => {
                  setFormData({ ...formData, webhookUrl: value })
                  setFormErrors({ ...formErrors, webhookUrl: '' })
                }}
                error={formErrors.webhookUrl}
              />
              <ChipModalField
                flush
                type='input'
                inputType='password'
                title='Secret (optional)'
                placeholder='Webhook secret for signature verification'
                autoComplete='new-password'
                value={formData.webhookSecret}
                onChange={(value) => setFormData({ ...formData, webhookSecret: value })}
              />
            </>
          )}

          {activeTab === 'email' && (
            <ChipModalField
              flush
              type='emails'
              title='Email Recipients'
              placeholder='Enter emails'
              value={formData.emailRecipients}
              onChange={handleEmailRecipientsChange}
              error={formErrors.emailRecipients}
            />
          )}

          {activeTab === 'slack' && (
            <>
              <ChipModalField
                flush
                type='custom'
                title='Slack Account'
                error={formErrors.slackAccountId}
              >
                {isLoadingSlackAccounts ? (
                  <Skeleton className='h-[34px] w-full rounded-md' />
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
                      className='flex items-center gap-2'
                    >
                      <SlackIcon className='size-[11px]' />
                      {connectSlack.isPending ? 'Connecting...' : 'Connect Slack'}
                    </Button>
                  </div>
                ) : (
                  <ChipCombobox
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
              </ChipModalField>
              {slackAccounts.length > 0 && (
                <ChipModalField flush type='custom' title='Channel'>
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
                </ChipModalField>
              )}
            </>
          )}

          <ChipModalField
            flush
            type='custom'
            title='Log Level Filters'
            error={formErrors.levelFilter}
          >
            <ChipCombobox
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
                      <Badge
                        key={level}
                        variant='outline'
                        className='pointer-events-auto cursor-pointer gap-1 rounded-md px-2 py-0.5 text-xs capitalize'
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
                        <X className='size-3' />
                      </Badge>
                    ))}
                  </div>
                ) : null
              }
              showAllOption
              allOptionLabel='All levels'
            />
          </ChipModalField>

          <ChipModalField
            flush
            type='custom'
            title='Trigger Type Filters'
            error={formErrors.triggerFilter}
          >
            <ChipCombobox
              options={TRIGGER_OPTIONS.map((t) => ({
                label: t.label,
                value: t.value,
              }))}
              multiSelect
              multiSelectValues={formData.triggerFilter}
              onMultiSelectChange={(values) => {
                setFormData({ ...formData, triggerFilter: values })
                setFormErrors({ ...formErrors, triggerFilter: '' })
              }}
              placeholder='Select trigger types...'
              overlayContent={
                formData.triggerFilter.length > 0 ? (
                  <div className='flex items-center gap-1 overflow-hidden'>
                    {formData.triggerFilter.slice(0, 6).map((trigger) => (
                      <Badge
                        key={trigger}
                        variant='outline'
                        className='pointer-events-auto cursor-pointer gap-1 rounded-md px-2 py-0.5 text-xs capitalize'
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
                        <X className='size-3' />
                      </Badge>
                    ))}
                    {formData.triggerFilter.length > 6 && (
                      <Badge variant='outline' className='rounded-md px-2 py-0.5 text-xs'>
                        +{formData.triggerFilter.length - 6}
                      </Badge>
                    )}
                  </div>
                ) : null
              }
              showAllOption
              allOptionLabel='All triggers'
            />
          </ChipModalField>

          <ChipModalField flush type='custom' title='Include in Payload'>
            <ChipCombobox
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
                  <div className='flex items-center gap-1 overflow-hidden'>
                    {selected.slice(0, 2).map((key) => (
                      <Badge
                        key={key}
                        variant='outline'
                        className='pointer-events-auto cursor-pointer gap-1 rounded-md px-2 py-0.5 text-xs'
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setFormData({ ...formData, [key]: false })
                        }}
                      >
                        {labels[key]}
                        <X className='size-3' />
                      </Badge>
                    ))}
                    {selected.length > 2 && (
                      <Badge variant='outline' className='rounded-md px-2 py-0.5 text-xs'>
                        +{selected.length - 2}
                      </Badge>
                    )}
                  </div>
                )
              })()}
              showAllOption
              allOptionLabel='None'
            />
          </ChipModalField>

          <ChipModalField
            flush
            type='custom'
            title='Rule'
            hint={ALERT_RULES.find((r) => r.value === formData.alertRule)?.description}
          >
            <ChipCombobox
              options={ALERT_RULES.map((rule) => ({
                value: rule.value,
                label: rule.label,
              }))}
              value={formData.alertRule}
              onChange={(value) => setFormData({ ...formData, alertRule: value as AlertRule })}
              placeholder='Select rule'
            />
          </ChipModalField>

          {formData.alertRule === 'consecutive_failures' && (
            <ChipModalField
              flush
              type='custom'
              title='Failure Count'
              error={formErrors.consecutiveFailures}
            >
              <ChipInput
                type='number'
                min={1}
                max={100}
                error={Boolean(formErrors.consecutiveFailures)}
                value={formData.consecutiveFailures}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    consecutiveFailures: Number.parseInt(e.target.value) || 1,
                  })
                }
              />
            </ChipModalField>
          )}

          {formData.alertRule === 'failure_rate' && (
            <div className='flex gap-4'>
              <ChipModalField
                flush
                type='custom'
                title='Failure Rate (%)'
                error={formErrors.failureRatePercent}
                className='flex-1'
              >
                <ChipInput
                  type='number'
                  min={1}
                  max={100}
                  error={Boolean(formErrors.failureRatePercent)}
                  value={formData.failureRatePercent}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      failureRatePercent: Number.parseInt(e.target.value) || 1,
                    })
                  }
                />
              </ChipModalField>
              <ChipModalField
                flush
                type='custom'
                title='Window (hours)'
                error={formErrors.windowHours}
                className='flex-1'
              >
                <ChipInput
                  type='number'
                  min={1}
                  max={168}
                  error={Boolean(formErrors.windowHours)}
                  value={formData.windowHours}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      windowHours: Number.parseInt(e.target.value) || 1,
                    })
                  }
                />
              </ChipModalField>
            </div>
          )}

          {formData.alertRule === 'latency_threshold' && (
            <ChipModalField
              flush
              type='custom'
              title='Duration Threshold (seconds)'
              error={formErrors.durationThresholdMs}
            >
              <ChipInput
                type='number'
                min={1}
                max={3600}
                error={Boolean(formErrors.durationThresholdMs)}
                value={Math.round(formData.durationThresholdMs / 1000)}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    durationThresholdMs: (Number.parseInt(e.target.value) || 1) * 1000,
                  })
                }
              />
            </ChipModalField>
          )}

          {formData.alertRule === 'latency_spike' && (
            <div className='flex gap-4'>
              <ChipModalField
                flush
                type='custom'
                title='Above Average (%)'
                error={formErrors.latencySpikePercent}
                className='flex-1'
              >
                <ChipInput
                  type='number'
                  min={10}
                  max={1000}
                  error={Boolean(formErrors.latencySpikePercent)}
                  value={formData.latencySpikePercent}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      latencySpikePercent: Number.parseInt(e.target.value) || 10,
                    })
                  }
                />
              </ChipModalField>
              <ChipModalField
                flush
                type='custom'
                title='Window (hours)'
                error={formErrors.windowHours}
                className='flex-1'
              >
                <ChipInput
                  type='number'
                  min={1}
                  max={168}
                  error={Boolean(formErrors.windowHours)}
                  value={formData.windowHours}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      windowHours: Number.parseInt(e.target.value) || 1,
                    })
                  }
                />
              </ChipModalField>
            </div>
          )}

          {formData.alertRule === 'cost_threshold' && (
            <ChipModalField
              flush
              type='custom'
              title='Cost Threshold ($)'
              error={formErrors.costThresholdDollars}
            >
              <ChipInput
                type='number'
                min={0.01}
                max={1000}
                step={0.01}
                error={Boolean(formErrors.costThresholdDollars)}
                value={formData.costThresholdDollars}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    costThresholdDollars: Number.parseFloat(e.target.value) || 0.01,
                  })
                }
              />
            </ChipModalField>
          )}

          {formData.alertRule === 'no_activity' && (
            <ChipModalField
              flush
              type='custom'
              title='Inactivity Period (hours)'
              error={formErrors.inactivityHours}
            >
              <ChipInput
                type='number'
                min={1}
                max={168}
                error={Boolean(formErrors.inactivityHours)}
                value={formData.inactivityHours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    inactivityHours: Number.parseInt(e.target.value) || 1,
                  })
                }
              />
            </ChipModalField>
          )}

          {formData.alertRule === 'error_count' && (
            <div className='flex gap-4'>
              <ChipModalField
                flush
                type='custom'
                title='Error Count'
                error={formErrors.errorCountThreshold}
                className='flex-1'
              >
                <ChipInput
                  type='number'
                  min={1}
                  max={1000}
                  error={Boolean(formErrors.errorCountThreshold)}
                  value={formData.errorCountThreshold}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      errorCountThreshold: Number.parseInt(e.target.value) || 1,
                    })
                  }
                />
              </ChipModalField>
              <ChipModalField
                flush
                type='custom'
                title='Window (hours)'
                error={formErrors.windowHours}
                className='flex-1'
              >
                <ChipInput
                  type='number'
                  min={1}
                  max={168}
                  error={Boolean(formErrors.windowHours)}
                  value={formData.windowHours}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      windowHours: Number.parseInt(e.target.value) || 1,
                    })
                  }
                />
              </ChipModalField>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <ChipModal open={open} onOpenChange={handleClose} srTitle='Notifications' size='lg'>
        <ChipModalHeader onClose={() => handleClose()}>Notifications</ChipModalHeader>

        <ChipModalBody className='max-h-[60vh] min-h-0 overflow-y-auto'>
          <ChipModalTabs
            tabs={[
              { value: 'webhook', label: 'Webhook' },
              { value: 'email', label: 'Email' },
              { value: 'slack', label: 'Slack' },
            ]}
            value={activeTab}
            onChange={(value) => {
              const tab = value as NotificationType
              const tabHasSubscriptions = getSubscriptionsForTab(tab).length > 0
              resetForm()
              setActiveTab(tab)
              setShowForm(!tabHasSubscriptions)
            }}
          />

          <div className='min-h-0 px-2'>
            <TabContent
              displayForm={displayForm}
              renderForm={renderForm}
              isLoading={isLoading}
              filteredSubscriptions={filteredSubscriptions}
              renderSubscriptionItem={renderSubscriptionItem}
            />
          </div>
        </ChipModalBody>

        <ChipModalFooter
          onCancel={handleClose}
          secondaryAction={
            displayForm && hasSubscriptions
              ? { label: 'Back', onClick: handleBackToList }
              : undefined
          }
          primaryAction={
            displayForm
              ? {
                  label:
                    createNotification.isPending || updateNotification.isPending
                      ? editingId
                        ? 'Updating...'
                        : 'Creating...'
                      : editingId
                        ? 'Update'
                        : 'Create',
                  onClick: handleSave,
                  disabled: createNotification.isPending || updateNotification.isPending,
                }
              : {
                  label: 'Add',
                  onClick: handleAddNew,
                  disabled: isLoading,
                }
          }
        />
      </ChipModal>

      <ChipConfirmModal
        open={showDeleteDialog}
        onOpenChange={(next) => {
          if (!next) setDeletingId(null)
          setShowDeleteDialog(next)
        }}
        srTitle='Delete Notification'
        title='Delete Notification'
        description={
          <>
            <span className='text-[var(--text-error)]'>
              This will permanently remove the notification and stop all deliveries.
            </span>{' '}
            This action cannot be undone.
          </>
        }
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: deleteNotification.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
})
