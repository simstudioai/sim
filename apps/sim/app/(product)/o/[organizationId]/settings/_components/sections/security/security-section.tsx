'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  FieldStack,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import {
  MIN_IDLE_TIMEOUT_HOURS,
  parseSessionPolicyHours,
  useOrganizationNetwork,
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/platform/lib/data/security'
import { plural } from '@/platform/shared/plural'

type SessionPolicy = NonNullable<ReturnType<typeof useOrganizationSessionPolicy>['data']>

interface SessionPolicyFormProps {
  organizationId: string
  policy: SessionPolicy
}

function SessionPolicyForm({ organizationId, policy }: SessionPolicyFormProps) {
  const updatePolicy = useUpdateOrganizationSessionPolicy()
  const revokeSessions = useRevokeOrganizationSessions()
  const initialMax = policy.configured.maxSessionHours?.toString() ?? ''
  const initialIdle = policy.configured.idleTimeoutHours?.toString() ?? ''
  const [maxHours, setMaxHours] = useState(initialMax)
  const [idleHours, setIdleHours] = useState(initialIdle)
  const [savedMax, setSavedMax] = useState(initialMax)
  const [savedIdle, setSavedIdle] = useState(initialIdle)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const dirty = maxHours !== savedMax || idleHours !== savedIdle

  function discard() {
    setMaxHours(savedMax)
    setIdleHours(savedIdle)
  }

  async function save() {
    if (updatePolicy.isPending) return
    const parsed = parseSessionPolicyHours(maxHours, idleHours)
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
      const nextMax = result.data.configured.maxSessionHours?.toString() ?? ''
      const nextIdle = result.data.configured.idleTimeoutHours?.toString() ?? ''
      setMaxHours((current) => (current === maxHours ? nextMax : current))
      setIdleHours((current) => (current === idleHours ? nextIdle : current))
      setSavedMax(nextMax)
      setSavedIdle(nextIdle)
      toast.success('Session policy updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update session policy'))
    }
  }

  return (
    <SettingsSection title='Session policies'>
      <FieldStack>
        <TextField
          label='Max session lifetime (hours)'
          inputMode='numeric'
          placeholder='No limit'
          value={maxHours}
          onChange={setMaxHours}
        />
        <TextField
          label={`Idle timeout (hours, min ${MIN_IDLE_TIMEOUT_HOURS})`}
          inputMode='numeric'
          placeholder='No limit'
          value={idleHours}
          onChange={setIdleHours}
        />
        <SettingsSaveBar
          dirty={dirty}
          saving={updatePolicy.isPending}
          onSave={() => void save()}
          onDiscard={discard}
        />
      </FieldStack>
      <SettingsRow
        label='End all sessions'
        description='Members must sign in again; your current session stays active'
      >
        <Button variant='quiet' destructive onClick={() => setConfirmingRevoke(true)}>
          Sign out all members
        </Button>
      </SettingsRow>
      <ConfirmDialog
        target={confirmingRevoke}
        onClose={() => setConfirmingRevoke(false)}
        title='Sign out all members'
        description='Every member of this organization will be signed out on their next request, except your current session. Members will need to sign in again.'
        confirmLabel='Sign out all'
        pendingLabel='Signing out…'
        onConfirm={async () => {
          const result = await revokeSessions.mutateAsync({ orgId: organizationId })
          toast.success(`Signed out ${plural(result.data.revokedSessions, 'session')}`)
        }}
      />
    </SettingsSection>
  )
}

function SessionPolicySection({
  organizationId,
  billingEnabled,
}: {
  organizationId: string
  billingEnabled: boolean
}) {
  const { data, error, isLoading, isFetching, refetch } =
    useOrganizationSessionPolicy(organizationId)
  if (isLoading) return <SettingsSection title='Session policies' />
  if (!data) {
    return (
      <SettingsSection title='Session policies'>
        <FieldStack>
          <FailureNotice
            message={getErrorMessage(error, 'Failed to load session policy')}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        </FieldStack>
      </SettingsSection>
    )
  }
  if (billingEnabled && !data.isEnterprise) {
    return (
      <SettingsSection title='Session policies'>
        <EmptyState title='Session policies are available on Enterprise plans only.' />
      </SettingsSection>
    )
  }
  return <SessionPolicyForm organizationId={organizationId} policy={data} />
}

function NetworkSection({ organizationId }: { organizationId: string }) {
  const { data, error, isPending, isFetching, refetch } = useOrganizationNetwork(organizationId)
  return (
    <SettingsSection title='Outbound IP addresses'>
      <FieldStack>
        {isPending ? null : error || !data || data.mode === 'unavailable' ? (
          <FailureNotice
            message={getErrorMessage(error, 'Could not load network settings')}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        ) : data.mode === 'gateway' && data.publicIps.length > 0 ? (
          <>
            <Muted>Allowlist every address below for supported HTTPS connections.</Muted>
            {data.publicIps.map((ip) => (
              <CopyField key={ip} label={`Outbound IP ${ip}`} value={`${ip}/32`} />
            ))}
          </>
        ) : (
          <Muted>
            {data.mode === 'blocked'
              ? 'Supported HTTPS connections are paused.'
              : data.mode === 'gateway'
                ? 'Your outbound IP addresses aren’t available yet.'
                : 'Outbound IP addresses are not configured for this organization.'}
          </Muted>
        )}
      </FieldStack>
    </SettingsSection>
  )
}

export default function SecuritySection({ organization }: SettingsSectionProps) {
  const { deployment } = organization
  const organizationId = organization.organization.id
  return (
    <SectionStack>
      <SettingsPageHeader />
      {(deployment.hosted || deployment.features.sessionPolicies) && (
        <SessionPolicySection
          key={organizationId}
          organizationId={organizationId}
          billingEnabled={deployment.billingEnabled}
        />
      )}
      <NetworkSection organizationId={organizationId} />
    </SectionStack>
  )
}
