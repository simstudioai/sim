'use client'

import { useState } from 'react'
import { Button, ChipConfirmModal, ChipCopyInput, ChipInput, ChipTag, toast } from '@sim/emcn'
import { Link } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationDomain } from '@/lib/api/contracts/organization'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu/row-actions-menu'
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
        trailing={
          <div className='flex items-center gap-2'>
            <ChipTag variant={isVerified ? 'mono' : 'gray'}>
              {isVerified ? 'Verified' : 'Pending'}
            </ChipTag>
            <RowActionsMenu
              label={`${domain.domain} actions`}
              actions={[{ label: 'Remove', onSelect: () => onRemove(domain), destructive: true }]}
            />
          </div>
        }
      />

      {!isVerified && domain.txtRecordValue && (
        <div className='flex flex-col gap-3 pl-[46px]'>
          <SettingRow
            label='Host / name'
            description='Some DNS providers append your zone automatically. If yours does, enter this host with the trailing zone removed.'
          >
            <ChipCopyInput
              value={domain.challengeHost}
              copyLabel='Copy host'
              inputClassName='font-mono'
            />
          </SettingRow>

          <SettingRow label='Value'>
            <ChipCopyInput
              value={domain.txtRecordValue}
              copyLabel='Copy value'
              inputClassName='font-mono'
            />
          </SettingRow>

          <div>
            <Button size='sm' onClick={handleVerify} disabled={verifyDomain.isPending}>
              {verifyDomain.isPending ? 'Checking...' : 'Verify'}
            </Button>
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

  return (
    <>
      <SettingsSection label='Verified domains'>
        <div className='flex flex-col gap-4.5'>
          <SettingRow
            label='Add a domain'
            description='Verify a domain your organization owns before configuring SSO for it. Verifying proves you control the domain, so no one else can point it at their identity provider.'
          >
            <div className='flex items-center gap-2'>
              <ChipInput
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                placeholder='acme.com'
                className='min-w-0 flex-1'
              />
              <Button onClick={handleAdd} disabled={addDomain.isPending || !newDomain.trim()}>
                {addDomain.isPending ? 'Adding...' : 'Add domain'}
              </Button>
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
          "? You'll need to verify it again before you can configure SSO for it. Existing SSO sign-in is not affected.",
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
