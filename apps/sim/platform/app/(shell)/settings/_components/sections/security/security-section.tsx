'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ActionRow,
  FieldStack,
  LoadingState,
  Muted,
  SectionSkeleton,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import {
  Button,
  CopyField,
  EmptyState,
  FailureNotice,
  Modal,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  MIN_IDLE_TIMEOUT_HOURS,
  parseSessionPolicyHours,
  useOrganizationNetwork,
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/platform/lib/data/security'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { toast } from '@/platform/lib/data/toast'
import { plural } from '@/platform/lib/plural'

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
  useSettingsUnsavedGuard({
    isDirty: dirty,
    navigationBlocked: updatePolicy.isPending,
    onDiscard: discard,
  })

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
          hint='Members must sign in again this many hours after signing in, regardless of activity. Leave empty for the default 30-day sliding session.'
          inputMode='numeric'
          placeholder='No limit'
          value={maxHours}
          onChange={setMaxHours}
        />
        <TextField
          label='Idle timeout (hours)'
          hint={`Sessions expire after this many hours without activity. Minimum ${MIN_IDLE_TIMEOUT_HOURS} hours.`}
          inputMode='numeric'
          placeholder='No limit'
          value={idleHours}
          onChange={setIdleHours}
        />
        <ActionRow>
          <Button
            variant='primary'
            disabled={!dirty || updatePolicy.isPending}
            onClick={() => void save()}
          >
            {updatePolicy.isPending ? 'Saving…' : 'Save'}
          </Button>
          {dirty && (
            <Button variant='quiet' disabled={updatePolicy.isPending} onClick={discard}>
              Discard
            </Button>
          )}
        </ActionRow>
      </FieldStack>
      <SettingsRow
        label='End all sessions'
        description='Members must sign in again. Your current session stays active.'
      >
        <Button variant='destructive' onClick={() => setConfirmingRevoke(true)}>
          Sign out all members
        </Button>
      </SettingsRow>
      <Modal
        variant='confirm'
        destructive
        open={confirmingRevoke}
        onOpenChange={setConfirmingRevoke}
        title='Sign out all members'
        description='Every member of this organization will be signed out on their next request, except your current session. Members will need to sign in again.'
        confirmLabel={revokeSessions.isPending ? 'Signing out…' : 'Sign out all'}
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
  if (isLoading) return <SectionSkeleton title='Session policies' rows={2} />
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
        {isPending ? (
          <LoadingState label='Loading network settings…' />
        ) : error || !data || data.mode === 'unavailable' ? (
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
