'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Chip, ChipSelect, toast } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { InfoNote } from '@/ee/components/info-note'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useOrganizationRetention,
  useUpdateOrganizationRetention,
} from '@/ee/data-retention/hooks/data-retention'
import { useOrganizations } from '@/hooks/queries/organization'

const logger = createLogger('DataRetentionSettings')

const DAY_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '1825', label: '5 years' },
  { value: 'never', label: 'Forever' },
] as const

function hoursToDisplayDays(hours: number | null): string {
  if (hours === null) return 'never'
  return String(Math.round(hours / 24))
}

function daysToHours(days: string): number | null {
  if (days === 'never') return null
  return Number(days) * 24
}

interface RetentionSelectProps {
  value: string
  onChange: (value: string) => void
}

function RetentionSelect({ value, onChange }: RetentionSelectProps) {
  const standard = DAY_OPTIONS.find((o) => o.value === value)
  const options = standard
    ? DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
    : [
        ...DAY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        { value, label: `${value} days (custom)` },
      ]

  return <ChipSelect value={value} onChange={onChange} options={options} align='start' />
}

export function DataRetentionSettings() {
  const { data: session, isPending: sessionPending } = useSession()
  const { data: orgsData, isLoading: orgsLoading } = useOrganizations()

  const activeOrganization = orgsData?.activeOrganization
  const orgId = activeOrganization?.id

  const { data, isLoading: retentionLoading } = useOrganizationRetention(orgId)
  const updateMutation = useUpdateOrganizationRetention()

  const userEmail = session?.user?.email
  const userRole = getUserRole(activeOrganization, userEmail)
  const canManage = userRole === 'owner' || userRole === 'admin'

  const [logDays, setLogDays] = useState('')
  const [softDeleteDays, setSoftDeleteDays] = useState('')
  const [taskCleanupDays, setTaskCleanupDays] = useState('')
  const [savedLogDays, setSavedLogDays] = useState('')
  const [savedSoftDeleteDays, setSavedSoftDeleteDays] = useState('')
  const [savedTaskCleanupDays, setSavedTaskCleanupDays] = useState('')
  const formInitializedRef = useRef(false)

  useEffect(() => {
    if (!data || formInitializedRef.current) return
    const log = hoursToDisplayDays(data.effective.logRetentionHours)
    const soft = hoursToDisplayDays(data.effective.softDeleteRetentionHours)
    const task = hoursToDisplayDays(data.effective.taskCleanupHours)
    setLogDays(log)
    setSoftDeleteDays(soft)
    setTaskCleanupDays(task)
    setSavedLogDays(log)
    setSavedSoftDeleteDays(soft)
    setSavedTaskCleanupDays(task)
    formInitializedRef.current = true
  }, [data])

  const hasChanges =
    logDays !== savedLogDays ||
    softDeleteDays !== savedSoftDeleteDays ||
    taskCleanupDays !== savedTaskCleanupDays

  async function handleSave() {
    if (!orgId) return
    try {
      await updateMutation.mutateAsync({
        orgId,
        settings: {
          logRetentionHours: daysToHours(logDays),
          softDeleteRetentionHours: daysToHours(softDeleteDays),
          taskCleanupHours: daysToHours(taskCleanupDays),
        },
      })
      setSavedLogDays(logDays)
      setSavedSoftDeleteDays(softDeleteDays)
      setSavedTaskCleanupDays(taskCleanupDays)
      toast.success('Data retention settings saved.')
    } catch (error) {
      const msg = toError(error).message
      logger.error('Failed to save data retention settings', { error: msg })
      toast.error(msg)
    }
  }

  if (sessionPending || orgsLoading || (orgId && retentionLoading)) {
    return null
  }

  if (!orgId) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Data retention is configured per organization. Join or create an organization to continue.
      </div>
    )
  }

  if (!data) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Failed to load data retention settings.
      </div>
    )
  }

  if (isBillingEnabled && !data.isEnterprise) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Data retention is available on Enterprise plans only.
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Only organization owners and admins can configure data retention settings.
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <div />
        <div className='flex items-center'>
          <Chip
            variant='primary'
            onClick={handleSave}
            disabled={updateMutation.isPending || !hasChanges}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Chip>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-8 pt-6 pb-6'>
          <InfoNote>Applies organization-wide</InfoNote>
          <SettingsSection label='Data Retention'>
            <div className='flex flex-col gap-5'>
              <SettingRow
                label='Log retention'
                description='How long execution logs are kept before they are permanently deleted.'
              >
                <RetentionSelect value={logDays} onChange={setLogDays} />
              </SettingRow>
              <SettingRow
                label='Soft deletion cleanup'
                description='How long deleted resources remain recoverable before they are permanently removed.'
              >
                <RetentionSelect value={softDeleteDays} onChange={setSoftDeleteDays} />
              </SettingRow>
              <SettingRow
                label='Task cleanup'
                description='How long copilot chats, runs, and inbox tasks are kept before they are permanently deleted.'
              >
                <RetentionSelect value={taskCleanupDays} onChange={setTaskCleanupDays} />
              </SettingRow>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
