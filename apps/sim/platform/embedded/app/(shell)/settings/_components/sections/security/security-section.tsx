'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import {
  useOrganizationSessionPolicy,
  useRevokeOrganizationSessions,
  useUpdateOrganizationSessionPolicy,
} from '@/ee/session-policy/hooks/session-policy'
import { parseSessionPolicyHours } from '@/ee/session-policy/lib/policy-form'
import { useOrganizationNetwork } from '@/hooks/queries/organization-network'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  Button,
  ConfirmDialog,
  CopyField,
  EmptyState,
  errorMessageOr,
  FailureNotice,
  QueryBoundary,
  SaveActions,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  DraftConflictNotice,
  FieldStack,
  Muted,
  SectionSkeleton,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useServerDraft } from '@/platform/embedded/app/(shell)/_components/use-server-draft'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { plural } from '@/platform/shared/plural'

type SessionPolicy = NonNullable<ReturnType<typeof useOrganizationSessionPolicy>['data']>

function hoursOf(configured: SessionPolicy['configured']) {
  return {
    maxHours: configured.maxSessionHours?.toString() ?? '',
    idleHours: configured.idleTimeoutHours?.toString() ?? '',
  }
}

const sameHours = (left: ReturnType<typeof hoursOf>, right: ReturnType<typeof hoursOf>) =>
  left.maxHours === right.maxHours && left.idleHours === right.idleHours

interface SessionPolicyFormProps {
  organizationId: string
  policy: SessionPolicy
}

function SessionPolicyForm({ organizationId, policy }: SessionPolicyFormProps) {
  const updatePolicy = useUpdateOrganizationSessionPolicy()
  const revokeSessions = useRevokeOrganizationSessions()
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const session = useServerDraft({
    server: hoursOf(policy.configured),
    isEqual: sameHours,
    saving: updatePolicy.isPending,
    merge: (mine, base, theirs) => ({
      maxHours: mine.maxHours === base.maxHours ? theirs.maxHours : mine.maxHours,
      idleHours: mine.idleHours === base.idleHours ? theirs.idleHours : mine.idleHours,
    }),
  })
  const { maxHours, idleHours } = session.draft

  useSettingsUnsavedGuard({
    isDirty: session.dirty,
    navigationBlocked: updatePolicy.isPending,
    onDiscard: session.takeLatest,
  })

  async function save() {
    if (updatePolicy.isPending || session.conflict) return
    const submitted = session.draft
    const parsed = parseSessionPolicyHours(submitted.maxHours, submitted.idleHours)
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
      session.markSaved(submitted, hoursOf(result.data.configured))
      toast.success('Session policy updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update session policy'))
    }
  }

  return (
    <>
      <SettingsSection title='Session policies'>
        <FieldStack>
          <TextField
            label='Max session lifetime (hours)'
            hint='Members must sign in again this many hours after signing in, regardless of activity. Leave empty for the default 30-day sliding session.'
            inputMode='numeric'
            placeholder='No limit'
            value={maxHours}
            onChange={(value) => session.edit((current) => ({ ...current, maxHours: value }))}
          />
          <TextField
            label='Idle timeout (hours)'
            hint={`Sessions expire after this many hours without activity. Minimum ${MIN_IDLE_TIMEOUT_HOURS} hours.`}
            inputMode='numeric'
            placeholder='No limit'
            value={idleHours}
            onChange={(value) => session.edit((current) => ({ ...current, idleHours: value }))}
          />
        </FieldStack>
      </SettingsSection>
      {session.conflict && (
        <DraftConflictNotice onKeepMine={session.keepMine} onTakeLatest={session.takeLatest} />
      )}
      <SaveActions
        dirty={session.dirty}
        saving={updatePolicy.isPending}
        blocked={session.conflict}
        onSave={() => void save()}
        onDiscard={session.takeLatest}
      />
      <SettingsSection title='Active sessions'>
        <SettingsRow
          label='End all sessions'
          description='Members must sign in again. Your current session stays active.'
        >
          <Button variant='destructive' onClick={() => setConfirmingRevoke(true)}>
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
    </>
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
  // Every state sits in the section's titled card, which a boundary around the read cannot hold.
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
  const network = useOrganizationNetwork(organizationId)
  return (
    <SettingsSection title='Outbound IP addresses'>
      <FieldStack>
        <QueryBoundary
          query={network}
          failure={errorMessageOr('Could not load network settings')}
          loadingLabel='Loading network settings…'
        >
          {(data) =>
            data.mode === 'unavailable' ? (
              <FailureNotice
                message='Could not load network settings'
                retrying={network.isFetching}
                onRetry={() => void network.refetch()}
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
            )
          }
        </QueryBoundary>
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
