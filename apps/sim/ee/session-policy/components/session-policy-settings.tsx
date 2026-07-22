'use client'

import { useEffect, useState } from 'react'
import { ChipConfirmModal, ChipInput, Label, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  MAX_SESSION_POLICY_HOURS,
  MIN_IDLE_TIMEOUT_HOURS,
  MIN_SESSION_LIFETIME_HOURS,
} from '@/lib/api/contracts/organization'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import {
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/ee/session-policy/hooks/session-policy'

interface SessionPolicySettingsProps {
  organizationId: string
}

interface HourFieldProps {
  id: string
  title: string
  hint: string
  value: string
  onChange: (value: string) => void
}

function HourField({ id, title, hint, value, onChange }: HourFieldProps) {
  return (
    <div className='flex flex-col gap-[9px]'>
      <Label htmlFor={id} className='font-normal text-[var(--text-muted)]'>
        {title}
      </Label>
      <ChipInput
        id={id}
        type='number'
        inputMode='numeric'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder='No limit'
        className='w-[220px]'
        inputClassName='[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
      />
      <p className='text-[var(--text-muted)] text-caption'>{hint}</p>
    </div>
  )
}

function parseHours(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

export function SessionPolicySettings({ organizationId }: SessionPolicySettingsProps) {
  const { data, isLoading } = useOrganizationSessionPolicy(organizationId)
  const updatePolicy = useUpdateOrganizationSessionPolicy()
  const revokeSessions = useRevokeOrganizationSessions()

  const [maxSessionHours, setMaxSessionHours] = useState('')
  const [idleTimeoutHours, setIdleTimeoutHours] = useState('')
  const [savedMaxSessionHours, setSavedMaxSessionHours] = useState('')
  const [savedIdleTimeoutHours, setSavedIdleTimeoutHours] = useState('')
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)
  const [formInitialized, setFormInitialized] = useState(false)

  useEffect(() => {
    if (!data || formInitialized) return
    const max = data.configured.maxSessionHours?.toString() ?? ''
    const idle = data.configured.idleTimeoutHours?.toString() ?? ''
    setMaxSessionHours(max)
    setIdleTimeoutHours(idle)
    setSavedMaxSessionHours(max)
    setSavedIdleTimeoutHours(idle)
    setFormInitialized(true)
  }, [data, formInitialized])

  const hasChanges =
    formInitialized &&
    (maxSessionHours !== savedMaxSessionHours || idleTimeoutHours !== savedIdleTimeoutHours)

  useSettingsUnsavedGuard({ isDirty: hasChanges })

  if (isLoading) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>Loading session policy...</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (isBillingEnabled && data && !data.isEnterprise) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          Session policies are available on Enterprise plans only.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  async function handleSave() {
    const max = parseHours(maxSessionHours)
    const idle = parseHours(idleTimeoutHours)

    if (
      Number.isNaN(max) ||
      (max !== null && (max < MIN_SESSION_LIFETIME_HOURS || max > MAX_SESSION_POLICY_HOURS))
    ) {
      toast.error(
        `Max session lifetime must be a whole number between ${MIN_SESSION_LIFETIME_HOURS} and ${MAX_SESSION_POLICY_HOURS}`
      )
      return
    }
    if (
      Number.isNaN(idle) ||
      (idle !== null && (idle < MIN_IDLE_TIMEOUT_HOURS || idle > MAX_SESSION_POLICY_HOURS))
    ) {
      toast.error(
        `Idle timeout must be a whole number between ${MIN_IDLE_TIMEOUT_HOURS} and ${MAX_SESSION_POLICY_HOURS}`
      )
      return
    }

    try {
      const result = await updatePolicy.mutateAsync({
        orgId: organizationId,
        settings: { maxSessionHours: max, idleTimeoutHours: idle },
      })
      const savedMax = result.data.configured.maxSessionHours?.toString() ?? ''
      const savedIdle = result.data.configured.idleTimeoutHours?.toString() ?? ''
      setMaxSessionHours(savedMax)
      setIdleTimeoutHours(savedIdle)
      setSavedMaxSessionHours(savedMax)
      setSavedIdleTimeoutHours(savedIdle)
      toast.success('Session policy updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update session policy'))
    }
  }

  function handleDiscard() {
    setMaxSessionHours(savedMaxSessionHours)
    setIdleTimeoutHours(savedIdleTimeoutHours)
  }

  async function handleConfirmRevoke() {
    try {
      const result = await revokeSessions.mutateAsync({ orgId: organizationId })
      setShowRevokeConfirm(false)
      toast.success(
        `Signed out ${result.data.revokedSessions} session${result.data.revokedSessions === 1 ? '' : 's'}`
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to revoke sessions'))
    }
  }

  return (
    <>
      <SettingsPanel
        actions={[
          {
            text: 'Sign out all members',
            variant: 'destructive',
            onSelect: () => setShowRevokeConfirm(true),
          },
          ...saveDiscardActions({
            dirty: hasChanges,
            saving: updatePolicy.isPending,
            onSave: handleSave,
            onDiscard: handleDiscard,
          }),
        ]}
      >
        <div className='flex flex-col gap-7'>
          <HourField
            id='max-session-hours'
            title='Max session lifetime (hours)'
            hint='Members must sign in again this many hours after signing in, regardless of activity. Leave empty for the default 30-day sliding session.'
            value={maxSessionHours}
            onChange={setMaxSessionHours}
          />
          <HourField
            id='idle-timeout-hours'
            title='Idle timeout (hours)'
            hint={`Sessions expire after this many hours without activity. Minimum ${MIN_IDLE_TIMEOUT_HOURS} hours.`}
            value={idleTimeoutHours}
            onChange={setIdleTimeoutHours}
          />
        </div>
      </SettingsPanel>
      <ChipConfirmModal
        open={showRevokeConfirm}
        onOpenChange={setShowRevokeConfirm}
        title='Sign out all members'
        text={[
          'Every member of this organization will be signed out on their next request, except your current session. Members will need to sign in again.',
        ]}
        confirm={{
          label: 'Sign out all',
          onClick: handleConfirmRevoke,
          pending: revokeSessions.isPending,
          pendingLabel: 'Signing out...',
        }}
      />
    </>
  )
}
