'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { Button, Combobox, toast } from '@/components/emcn'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingRow } from '@/ee/components/setting-row'
import { DataRetentionSkeleton } from '@/ee/data-retention/components/data-retention-skeleton'
import {
  useUpdateWorkspaceRetention,
  useWorkspaceRetention,
} from '@/ee/data-retention/hooks/data-retention'

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

  return (
    <div className='w-[200px]'>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        dropdownWidth='trigger'
        className='h-[36px] text-[13px]'
      />
    </div>
  )
}

export function DataRetentionSettings() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId

  const { data, isLoading } = useWorkspaceRetention(workspaceId)
  const { canAdmin } = useUserPermissionsContext()
  const updateMutation = useUpdateWorkspaceRetention()

  const [logDays, setLogDays] = useState('')
  const [softDeleteDays, setSoftDeleteDays] = useState('')
  const [taskCleanupDays, setTaskCleanupDays] = useState('')
  const [savedLogDays, setSavedLogDays] = useState('')
  const [savedSoftDeleteDays, setSavedSoftDeleteDays] = useState('')
  const [savedTaskCleanupDays, setSavedTaskCleanupDays] = useState('')
  const [formInitialized, setFormInitialized] = useState(false)

  useEffect(() => {
    if (!data || formInitialized) return
    const log = hoursToDisplayDays(data.effective.logRetentionHours)
    const soft = hoursToDisplayDays(data.effective.softDeleteRetentionHours)
    const task = hoursToDisplayDays(data.effective.taskCleanupHours)
    setLogDays(log)
    setSoftDeleteDays(soft)
    setTaskCleanupDays(task)
    setSavedLogDays(log)
    setSavedSoftDeleteDays(soft)
    setSavedTaskCleanupDays(task)
    setFormInitialized(true)
  }, [data, formInitialized])

  const hasChanges =
    logDays !== savedLogDays ||
    softDeleteDays !== savedSoftDeleteDays ||
    taskCleanupDays !== savedTaskCleanupDays

  async function handleSave() {
    try {
      await updateMutation.mutateAsync({
        workspaceId,
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

  if (isLoading) return <DataRetentionSkeleton />

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

  if (!canAdmin) {
    return (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
        Only workspace admins can configure data retention settings.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-8'>
      <section>
        <h3 className='mb-4 font-medium text-[15px] text-[var(--text-primary)]'>
          Retention Periods
        </h3>
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
      </section>

      <div className='flex items-center justify-end'>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={updateMutation.isPending || !hasChanges}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
