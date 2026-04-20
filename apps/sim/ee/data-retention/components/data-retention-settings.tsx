'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Label } from '@/components/emcn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
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

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Label className='text-[13px] text-[var(--text-primary)]'>{label}</Label>
      {description && <p className='text-[12px] text-[var(--text-muted)]'>{description}</p>}
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className='mb-4 font-medium text-[15px] text-[var(--text-primary)]'>{children}</h3>
}

interface RetentionSelectProps {
  value: string
  onChange: (value: string) => void
}

function RetentionSelect({ value, onChange }: RetentionSelectProps) {
  const standard = DAY_OPTIONS.find((o) => o.value === value)
  const options = standard
    ? DAY_OPTIONS
    : [...DAY_OPTIONS, { value, label: `${value} days (custom)` } as const]

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className='h-[36px] max-w-[200px] text-[13px]'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className='text-[13px]'>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const [formInitialized, setFormInitialized] = useState(false)

  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  if (data && !formInitialized) {
    setLogDays(hoursToDisplayDays(data.effective.logRetentionHours))
    setSoftDeleteDays(hoursToDisplayDays(data.effective.softDeleteRetentionHours))
    setTaskCleanupDays(hoursToDisplayDays(data.effective.taskCleanupHours))
    setFormInitialized(true)
  }

  const handleSave = useCallback(async () => {
    setSaveError(null)
    setSaveSuccess(false)

    try {
      await updateMutation.mutateAsync({
        workspaceId,
        settings: {
          logRetentionHours: daysToHours(logDays),
          softDeleteRetentionHours: daysToHours(softDeleteDays),
          taskCleanupHours: daysToHours(taskCleanupDays),
        },
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to save data retention settings', { error })
      setSaveError(toError(error).message)
    }
  }, [workspaceId, logDays, softDeleteDays, taskCleanupDays])

  if (isLoading) {
    return (
      <div className='flex flex-col gap-8'>
        {[...Array(3)].map((_, i) => (
          <div key={i} className='flex flex-col gap-3'>
            <div className='h-4 w-32 animate-pulse rounded bg-[var(--surface-3)]' />
            <div className='h-9 w-full animate-pulse rounded-lg bg-[var(--surface-3)]' />
          </div>
        ))}
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

  if (!data.isEnterprise) {
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
        <SectionTitle>Retention Periods</SectionTitle>
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

      <div className='flex items-center gap-3'>
        <Button onClick={handleSave} disabled={updateMutation.isPending} className='text-[13px]'>
          {updateMutation.isPending ? (
            <>
              <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
              Saving…
            </>
          ) : (
            'Save changes'
          )}
        </Button>
        {saveSuccess && (
          <span className='text-[13px] text-green-500'>Settings saved successfully.</span>
        )}
        {saveError && <span className='text-[13px] text-red-500'>{saveError}</span>}
      </div>
    </div>
  )
}
