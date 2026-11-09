'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  type OrganizationDomain,
  useAddOrganizationDomain,
  useOrganizationDomains,
  useRemoveOrganizationDomain,
  useVerifyOrganizationDomain,
} from '@/platform/lib/data/sso'

interface DomainRowProps {
  organizationId: string
  domain: OrganizationDomain
  onRemove: (domain: OrganizationDomain) => void
}

function DomainRow({ organizationId, domain, onRemove }: DomainRowProps) {
  const verifyDomain = useVerifyOrganizationDomain()
  const isVerified = domain.status === 'verified'

  async function verify() {
    try {
      await verifyDomain.mutateAsync({ orgId: organizationId, domainId: domain.id })
      toast.success(`${domain.domain} verified`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Verification failed — check the DNS record and retry'))
    }
  }

  return (
    <>
      <SettingsRow
        label={domain.domain}
        description={isVerified ? 'Ownership verified' : 'Awaiting DNS verification'}
      >
        <ActionRow>
          <StatusTag
            live
            label={isVerified ? 'Verified' : 'Pending'}
            intent={isVerified ? 'success' : 'neutral'}
          />
          <ActionMenu
            label={`${domain.domain} actions`}
            icon='I108'
            actions={[
              {
                id: 'remove',
                label: 'Remove',
                destructive: true,
                onSelect: () => onRemove(domain),
              },
            ]}
          />
        </ActionRow>
      </SettingsRow>
      {!isVerified && domain.txtRecordValue && (
        <FieldStack>
          <CopyField
            label='Host / name'
            value={domain.challengeHost}
            hint='Some DNS providers append your zone automatically. If yours does, enter this host with the trailing zone removed.'
          />
          <CopyField label='Value' value={domain.txtRecordValue} />
          <ActionRow>
            <Button size='compact' disabled={verifyDomain.isPending} onClick={() => void verify()}>
              {verifyDomain.isPending ? 'Checking…' : 'Verify'}
            </Button>
          </ActionRow>
        </FieldStack>
      )}
    </>
  )
}

/** Domain ownership shared by SSO and SCIM. */
export function DomainsPanel({
  organizationId,
  active,
}: {
  organizationId: string
  active: boolean
}) {
  const { data, isLoading, isError, error, isFetching, refetch } = useOrganizationDomains(
    organizationId,
    { enabled: active }
  )
  const addDomain = useAddOrganizationDomain()
  const removeDomain = useRemoveOrganizationDomain()
  const [newDomain, setNewDomain] = useState('')
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const domains = data?.domains ?? []
  const pendingRemoval = domains.find((domain) => domain.id === pendingRemovalId) ?? null
  useSettingsUnsavedGuard({
    isDirty: newDomain.trim().length > 0,
    navigationBlocked: addDomain.isPending || removeDomain.isPending,
    onDiscard: () => setNewDomain(''),
  })
  const canAdd = !addDomain.isPending && newDomain.trim().length > 0

  async function add() {
    const value = newDomain.trim()
    if (!value) return
    try {
      await addDomain.mutateAsync({ orgId: organizationId, body: { domain: value } })
      setNewDomain((current) => (current.trim() === value ? '' : current))
      toast.success(`${value} added — add the DNS record and verify`)
    } catch (failure) {
      toast.error(getErrorMessage(failure, 'Failed to add domain'))
    }
  }

  return (
    <SectionStack>
      <SettingsSection title='Verified domains'>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canAdd) void add()
          }}
        >
          <FieldStack>
            <TextField
              label='Add a domain'
              hint='Prove ownership with a DNS record before using this domain for SSO or directory provisioning.'
              placeholder='acme.com'
              value={newDomain}
              onChange={setNewDomain}
            />
            <ActionRow>
              <Button variant='primary' submit disabled={!canAdd}>
                {addDomain.isPending ? 'Adding…' : 'Add domain'}
              </Button>
            </ActionRow>
          </FieldStack>
        </form>
        {isLoading ? null : data === undefined && isError ? (
          <FieldStack>
            <FailureNotice
              message={getErrorMessage(error, 'Failed to load verified domains')}
              retrying={isFetching}
              onRetry={() => void refetch()}
            />
          </FieldStack>
        ) : domains.length === 0 ? (
          <FieldStack>
            <Muted>No domains yet.</Muted>
          </FieldStack>
        ) : (
          domains.map((domain) => (
            <DomainRow
              key={domain.id}
              organizationId={organizationId}
              domain={domain}
              onRemove={(target) => setPendingRemovalId(target.id)}
            />
          ))
        )}
      </SettingsSection>
      <Modal
        variant='confirm'
        destructive
        open={active && pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemovalId(null)
        }}
        title='Remove domain'
        description={`Remove ${pendingRemoval?.domain ?? ''}? This immediately disables SSO sign-in for anyone on that domain, because the proof is what grants your identity provider its authority. Verifying the domain again restores it.`}
        confirmLabel={removeDomain.isPending ? 'Removing…' : 'Remove'}
        onConfirm={async () => {
          if (!pendingRemoval) return
          await removeDomain.mutateAsync({ orgId: organizationId, domainId: pendingRemoval.id })
          toast.success(`${pendingRemoval.domain} removed`)
        }}
      />
    </SectionStack>
  )
}
