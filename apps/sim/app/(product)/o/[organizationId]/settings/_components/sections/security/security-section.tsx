'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  FieldStack,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
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
  const savedMax = policy.configured.maxSessionHours?.toString() ?? ''
  const savedIdle = policy.configured.idleTimeoutHours?.toString() ?? ''
  const [draftMax, setDraftMax] = useState<string | null>(null)
  const [draftIdle, setDraftIdle] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const maxHours = draftMax ?? savedMax
  const idleHours = draftIdle ?? savedIdle
  const dirty = maxHours !== savedMax || idleHours !== savedIdle
  const maxCheck = parseSessionPolicyHours(maxHours, '')
  const idleCheck = parseSessionPolicyHours('', idleHours)
  const maxError = attempted && !maxCheck.ok ? maxCheck.error : undefined
  const idleError = attempted && !idleCheck.ok ? idleCheck.error : undefined

  function discard() {
    setDraftMax(null)
    setDraftIdle(null)
    setAttempted(false)
  }

  async function save() {
    if (updatePolicy.isPending) return
    setAttempted(true)
    const parsed = parseSessionPolicyHours(maxHours, idleHours)
    if (!parsed.ok) return
    try {
      await updatePolicy.mutateAsync({
        orgId: organizationId,
        settings: {
          maxSessionHours: parsed.maxSessionHours,
          idleTimeoutHours: parsed.idleTimeoutHours,
        },
      })
      setDraftMax((current) => (current === maxHours ? null : current))
      setDraftIdle((current) => (current === idleHours ? null : current))
      setAttempted(false)
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
          error={maxError}
          onChange={setDraftMax}
        />
        <TextField
          label={`Idle timeout (hours, min ${MIN_IDLE_TIMEOUT_HOURS})`}
          inputMode='numeric'
          placeholder='No limit'
          value={idleHours}
          error={idleError}
          onChange={setDraftIdle}
        />
        <SettingsSaveBar
          dirty={dirty}
          saving={updatePolicy.isPending}
          blocked={Boolean(maxError || idleError)}
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
        description='Every member except your current session is signed out on their next request and must sign in again'
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
  const query = useOrganizationSessionPolicy(organizationId)
  return (
    <SettingsRead query={query} failureMessage='Failed to load session policy'>
      {(policy) =>
        billingEnabled && !policy.isEnterprise ? (
          <SettingsList
            title='Session policies'
            empty={{ title: 'Session policies are available on Enterprise plans' }}
          />
        ) : (
          <SessionPolicyForm organizationId={organizationId} policy={policy} />
        )
      }
    </SettingsRead>
  )
}

const NETWORK_EMPTY = {
  blocked: 'Supported HTTPS connections are paused',
  gateway: 'Your outbound IP addresses aren’t available yet',
  direct: 'Outbound IP addresses are not configured for this organization',
} as const

function NetworkSection({ organizationId }: { organizationId: string }) {
  const query = useOrganizationNetwork(organizationId)
  return (
    <SettingsRead query={query} failureMessage='Could not load network settings'>
      {(network) => {
        if (network.mode === 'unavailable') {
          return (
            <FailureNotice
              message='Could not load network settings'
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          )
        }
        if (network.mode === 'gateway' && network.publicIps.length > 0) {
          return (
            <SettingsSection title='Outbound IP addresses'>
              <FieldStack>
                <Muted>Allowlist every address below for supported HTTPS connections</Muted>
                {network.publicIps.map((ip) => (
                  <CopyField key={ip} label={`Outbound IP ${ip}`} value={`${ip}/32`} />
                ))}
              </FieldStack>
            </SettingsSection>
          )
        }
        return (
          <SettingsList
            title='Outbound IP addresses'
            empty={{ title: NETWORK_EMPTY[network.mode] }}
          />
        )
      }}
    </SettingsRead>
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
