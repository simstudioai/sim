'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { FailureNotice } from '@sim/emcn/status'
import { errorMessageOr, QueryBoundary } from '@sim/emcn/status/query-boundary'
import {
  MIN_IDLE_TIMEOUT_HOURS,
  type OrganizationSessionPolicy,
} from '@/lib/api/contracts/organization'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  DraftConflictNotice,
  FieldStack,
  Muted,
  SectionSkeleton,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useServerDraft } from '@/platform/embedded/app/(shell)/_components/use-server-draft'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { useOutboundAddresses } from '@/platform/embedded/lib/data/network'
import {
  useSessionPolicy,
  useSessionPolicyWrites,
} from '@/platform/embedded/lib/data/session-policy'

function hoursOf(configured: OrganizationSessionPolicy['configured']) {
  return {
    maxHours: configured.maxSessionHours?.toString() ?? '',
    idleHours: configured.idleTimeoutHours?.toString() ?? '',
  }
}

const sameHours = (left: ReturnType<typeof hoursOf>, right: ReturnType<typeof hoursOf>) =>
  left.maxHours === right.maxHours && left.idleHours === right.idleHours

interface SessionPolicyFormProps {
  organizationId: string
  policy: OrganizationSessionPolicy
}

function SessionPolicyForm({ organizationId, policy }: SessionPolicyFormProps) {
  const writes = useSessionPolicyWrites(organizationId)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const session = useServerDraft({
    server: hoursOf(policy.configured),
    isEqual: sameHours,
    saving: writes.saving,
    merge: (mine, base, theirs) => ({
      maxHours: mine.maxHours === base.maxHours ? theirs.maxHours : mine.maxHours,
      idleHours: mine.idleHours === base.idleHours ? theirs.idleHours : mine.idleHours,
    }),
  })
  const { maxHours, idleHours } = session.draft

  useSettingsUnsavedGuard({
    isDirty: session.dirty,
    navigationBlocked: writes.saving,
    onDiscard: session.takeLatest,
  })

  async function save() {
    if (writes.saving || session.conflict) return
    const submitted = session.draft
    await writes.save(submitted, (configured) => {
      session.markSaved(submitted, hoursOf(configured))
    })
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
        saving={writes.saving}
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
          onConfirm={writes.revokeAll}
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
  const read = useSessionPolicy(organizationId, billingEnabled)
  // Every state sits in the section's titled card, which a boundary around the read cannot hold.
  if (read.status === 'loading') return <SectionSkeleton title='Session policies' rows={2} />
  if (read.status === 'failed') {
    return (
      <SettingsSection title='Session policies'>
        <FieldStack>
          <FailureNotice message={read.message} retrying={read.retrying} onRetry={read.retry} />
        </FieldStack>
      </SettingsSection>
    )
  }
  if (read.status === 'enterprise-only') {
    return (
      <SettingsSection title='Session policies'>
        <EmptyState title='Session policies are available on Enterprise plans only.' />
      </SettingsSection>
    )
  }
  return <SessionPolicyForm organizationId={organizationId} policy={read.policy} />
}

function NetworkSection({ organizationId }: { organizationId: string }) {
  const network = useOutboundAddresses(organizationId)
  return (
    <SettingsSection title='Outbound IP addresses'>
      <FieldStack>
        <QueryBoundary
          query={network}
          failure={errorMessageOr('Could not load network settings')}
          loadingLabel='Loading network settings…'
        >
          {(data) =>
            data.kind === 'unavailable' ? (
              <FailureNotice
                message='Could not load network settings'
                retrying={network.isFetching}
                onRetry={() => void network.refetch()}
              />
            ) : data.kind === 'allowlist' ? (
              <>
                <Muted>Allowlist every address below for supported HTTPS connections.</Muted>
                {data.publicIps.map((ip) => (
                  <CopyField key={ip} label={`Outbound IP ${ip}`} value={`${ip}/32`} />
                ))}
              </>
            ) : (
              <Muted>{data.message}</Muted>
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
