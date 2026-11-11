'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
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
export function DomainsPanel({ organizationId }: { organizationId: string }) {
  const domainsQuery = useOrganizationDomains(organizationId)
  const addDomain = useAddOrganizationDomain()
  const removeDomain = useRemoveOrganizationDomain()
  const [newDomain, setNewDomain] = useState('')
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const domains = domainsQuery.data?.domains ?? []
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
      <SettingsRead query={domainsQuery} failureMessage='Failed to load verified domains'>
        {({ domains: list }) => (
          <SettingsList
            title='Verified domains'
            empty={
              list.length === 0
                ? {
                    title: 'No domains yet',
                    description: 'Verify an email domain to use it for SSO and SCIM',
                  }
                : undefined
            }
          >
            {list.map((domain) => (
              <DomainRow
                key={domain.id}
                organizationId={organizationId}
                domain={domain}
                onRemove={(target) => setPendingRemovalId(target.id)}
              />
            ))}
          </SettingsList>
        )}
      </SettingsRead>
      <SettingsSection title='Add domain'>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canAdd) void add()
          }}
        >
          <FieldStack>
            <TextField
              label='Domain'
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
      </SettingsSection>
      <ConfirmDialog
        target={pendingRemoval}
        onClose={() => setPendingRemovalId(null)}
        title={`Remove ${pendingRemoval?.domain ?? 'domain'}`}
        description='SSO sign-in stops at once for anyone on this domain, because the proof is what grants your identity provider its authority. Verifying the domain again restores it'
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={async (domain) => {
          await removeDomain.mutateAsync({ orgId: organizationId, domainId: domain.id })
          toast.success(`${domain.domain} removed`)
        }}
      />
    </SectionStack>
  )
}
