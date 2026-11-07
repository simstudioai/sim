'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipInput, Label, toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  type SessionPolicyResponse,
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/ee/session-policy/hooks/session-policy'
import { parseSessionPolicyHours } from '@/ee/session-policy/lib/policy-form'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'

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
        inputMode='numeric'
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder='No limit'
        className='w-[220px]'
      />
      <p className='text-[var(--text-muted)] text-caption'>{hint}</p>
    </div>
  )
}

interface SessionPolicyFormProps extends SessionPolicySettingsProps {
  initialData: SessionPolicyResponse
}

function SessionPolicyForm({ organizationId, initialData }: SessionPolicyFormProps) {
  const updatePolicy = useUpdateOrganizationSessionPolicy()
  const { billingEnabled } = useDeploymentShape()
  const revokeSessions = useRevokeOrganizationSessions()

  const initialMaxSessionHours = initialData.configured.maxSessionHours?.toString() ?? ''
  const initialIdleTimeoutHours = initialData.configured.idleTimeoutHours?.toString() ?? ''
  const [maxSessionHours, setMaxSessionHours] = useState(initialMaxSessionHours)
  const [idleTimeoutHours, setIdleTimeoutHours] = useState(initialIdleTimeoutHours)
  const [savedMaxSessionHours, setSavedMaxSessionHours] = useState(initialMaxSessionHours)
  const [savedIdleTimeoutHours, setSavedIdleTimeoutHours] = useState(initialIdleTimeoutHours)
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false)

  const hasChanges =
    maxSessionHours !== savedMaxSessionHours || idleTimeoutHours !== savedIdleTimeoutHours

  useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: updatePolicy.isPending,
    onDiscard: handleDiscard,
  })

  async function handleSave() {
    if (updatePolicy.isPending) return
    const parsed = parseSessionPolicyHours(maxSessionHours, idleTimeoutHours)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }

    try {
      const result = await updatePolicy.mutateAsync({
        orgId: organizationId,
        settings: {
          maxSessionHours: parsed.maxSessionHours,
          idleTimeoutHours: parsed.idleTimeoutHours,
        },
      })
      const savedMax = result.data.configured.maxSessionHours?.toString() ?? ''
      const savedIdle = result.data.configured.idleTimeoutHours?.toString() ?? ''
      setMaxSessionHours((current) => (current === maxSessionHours ? savedMax : current))
      setIdleTimeoutHours((current) => (current === idleTimeoutHours ? savedIdle : current))
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

  const actions = [
    {
      id: 'revoke-sessions',
      text: 'Sign out all members',
      variant: 'destructive' as const,
      onSelect: () => setShowRevokeConfirm(true),
      disabled: false,
    },
    ...saveDiscardActions({
      dirty: hasChanges,
      saving: updatePolicy.isPending,
      onSave: handleSave,
      onDiscard: handleDiscard,
    }),
  ]

  if (billingEnabled && !initialData.isEnterprise) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          Session policies are available on Enterprise plans only.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  return (
    <>
      <SettingsPanel actions={actions}>
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

export function SessionPolicySettings({ organizationId }: SessionPolicySettingsProps) {
  const { data, error, isLoading } = useOrganizationSessionPolicy(organizationId)

  if (isLoading) {
    return (
      <SettingsPanel
        actions={[
          {
            id: 'revoke-sessions',
            text: 'Sign out all members',
            variant: 'destructive',
            disabled: true,
            onSelect: () => undefined,
          },
          ...saveDiscardActions({
            dirty: false,
            saving: false,
            saveDisabled: true,
            onSave: () => undefined,
            onDiscard: () => undefined,
          }),
        ]}
      >
        <SettingsEmptyState>Loading session policy...</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (!data) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          {getErrorMessage(error, 'Failed to load session policy')}
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  return (
    <SessionPolicyForm key={organizationId} organizationId={organizationId} initialData={data} />
  )
}
