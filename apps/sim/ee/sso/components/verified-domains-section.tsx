'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipCopyInput, ChipInput, ChipTag, toast } from '@sim/emcn'
import { Link } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationDomain } from '@/lib/api/contracts/organization'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useAddOrganizationDomain,
  useOrganizationDomains,
  useRemoveOrganizationDomain,
  useVerifyOrganizationDomain,
} from '@/ee/sso/hooks/domains'

/** Ties the "Add a domain" label to its input, so clicking the label focuses it. */
const ADD_DOMAIN_FIELD_ID = 'sso-add-domain'

interface VerifiedDomainsSectionProps {
  organizationId: string
}

interface DomainRowProps {
  organizationId: string
  domain: OrganizationDomain
  onRemove: (domain: OrganizationDomain) => void
}

function DomainRow({ organizationId, domain, onRemove }: DomainRowProps) {
  const verifyDomain = useVerifyOrganizationDomain()
  const isVerified = domain.status === 'verified'

  async function handleVerify() {
    try {
      await verifyDomain.mutateAsync({ orgId: organizationId, domainId: domain.id })
      toast.success(`${domain.domain} verified`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Verification failed — check the DNS record and retry'))
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <SettingsResourceRow
        icon={<Link />}
        title={domain.domain}
        description={isVerified ? 'Ownership verified' : 'Awaiting DNS verification'}
        badge={
          <ChipTag variant={isVerified ? 'mono' : 'gray'}>
            {isVerified ? 'Verified' : 'Pending'}
          </ChipTag>
        }
        trailing={
          <RowActionsMenu
            label={`${domain.domain} actions`}
            actions={[{ label: 'Remove', onSelect: () => onRemove(domain), destructive: true }]}
          />
        }
      />

      {/* pl-[46px] indents past SettingsResourceRow's icon gutter (size-9 tile + gap-2.5). */}
      {!isVerified && domain.txtRecordValue && (
        <div className='flex flex-col gap-3 pl-[46px]'>
          <SettingRow
            label='Host / name'
            description='Some DNS providers append your zone automatically. If yours does, enter this host with the trailing zone removed.'
            htmlFor={`${domain.id}-challenge-host`}
          >
            <ChipCopyInput
              id={`${domain.id}-challenge-host`}
              value={domain.challengeHost}
              copyLabel='Copy host'
              inputClassName='font-mono'
            />
          </SettingRow>

          <SettingRow label='Value' htmlFor={`${domain.id}-challenge-value`}>
            <ChipCopyInput
              id={`${domain.id}-challenge-value`}
              value={domain.txtRecordValue}
              copyLabel='Copy value'
              inputClassName='font-mono'
            />
          </SettingRow>

          <div>
            <Chip onClick={handleVerify} disabled={verifyDomain.isPending}>
              {verifyDomain.isPending ? 'Checking...' : 'Verify'}
            </Chip>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Domain-ownership management, rendered as a section of the SSO settings page.
 * A domain must be verified here before SSO can be configured for it, so the two
 * live together rather than sending the admin to a separate page mid-setup.
 */
export function VerifiedDomainsSection({ organizationId }: VerifiedDomainsSectionProps) {
  const { data, isLoading } = useOrganizationDomains(organizationId)
  const addDomain = useAddOrganizationDomain()
  const removeDomain = useRemoveOrganizationDomain()

  const [newDomain, setNewDomain] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<OrganizationDomain | null>(null)

  async function handleAdd() {
    const value = newDomain.trim()
    if (!value) return
    try {
      await addDomain.mutateAsync({ orgId: organizationId, body: { domain: value } })
      setNewDomain('')
      toast.success(`${value} added — add the DNS record and verify`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add domain'))
    }
  }

  async function handleConfirmRemove() {
    if (!pendingRemoval) return
    try {
      await removeDomain.mutateAsync({ orgId: organizationId, domainId: pendingRemoval.id })
      setPendingRemoval(null)
      toast.success(`${pendingRemoval.domain} removed`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove domain'))
    }
  }

  const domains = data?.domains ?? []
  /** Single source of truth for both the Add chip and the Enter shortcut. */
  const canAddDomain = !addDomain.isPending && newDomain.trim().length > 0

  return (
    <>
      <SettingsSection label='Verified domains'>
        <div className='flex flex-col gap-4.5'>
          <SettingRow
            label='Add a domain'
            description='Verify a domain your organization owns before configuring SSO for it. Verifying proves you control the domain, so no one else can point it at their identity provider.'
            htmlFor={ADD_DOMAIN_FIELD_ID}
          >
            <div className='flex items-center gap-2'>
              <ChipInput
                id={ADD_DOMAIN_FIELD_ID}
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                onKeyDown={(event) => {
                  // This section renders inside the SSO provider <form>, so a bare
                  // Enter would submit that form instead of adding the domain.
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  if (canAddDomain) void handleAdd()
                }}
                placeholder='acme.com'
                className='min-w-0 flex-1'
              />
              <Chip variant='primary' onClick={handleAdd} disabled={!canAddDomain}>
                {addDomain.isPending ? 'Adding...' : 'Add domain'}
              </Chip>
            </div>
          </SettingRow>

          {isLoading ? (
            <SettingsEmptyState variant='inline'>Loading domains...</SettingsEmptyState>
          ) : domains.length === 0 ? (
            <SettingsEmptyState variant='inline'>No domains yet.</SettingsEmptyState>
          ) : (
            <div className='flex flex-col gap-4'>
              {domains.map((domain) => (
                <DomainRow
                  key={domain.id}
                  organizationId={organizationId}
                  domain={domain}
                  onRemove={setPendingRemoval}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      <ChipConfirmModal
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        title='Remove domain'
        text={[
          'Remove ',
          { text: pendingRemoval?.domain ?? '', bold: true },
          '? This immediately disables SSO sign-in for anyone on that domain, because the proof is what grants your identity provider its authority. Verifying the domain again restores it.',
        ]}
        confirm={{
          label: 'Remove',
          onClick: handleConfirmRemove,
          pending: removeDomain.isPending,
          pendingLabel: 'Removing...',
        }}
      />
    </>
  )
}
