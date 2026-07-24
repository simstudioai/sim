'use client'

import { useState } from 'react'
import { Button, ChipConfirmModal, ChipCopyInput, ChipInput, ChipTag, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationDomain } from '@/lib/api/contracts/organization'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  useAddOrganizationDomain,
  useOrganizationDomains,
  useRemoveOrganizationDomain,
  useVerifyOrganizationDomain,
} from '@/ee/sso/hooks/domains'

interface DomainSettingsProps {
  organizationId: string
}

interface CopyFieldProps {
  label: string
  value: string
}

function CopyField({ label, value }: CopyFieldProps) {
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-[var(--text-muted)] text-caption'>{label}</span>
      <ChipCopyInput value={value} copyLabel={`Copy ${label}`} inputClassName='font-mono' />
    </div>
  )
}

interface DomainRowProps {
  organizationId: string
  domain: OrganizationDomain
  onRemove: (domain: OrganizationDomain) => void
}

function DomainRow({ organizationId, domain, onRemove }: DomainRowProps) {
  const verifyDomain = useVerifyOrganizationDomain()

  async function handleVerify() {
    try {
      await verifyDomain.mutateAsync({ orgId: organizationId, domainId: domain.id })
      toast.success(`${domain.domain} verified`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Verification failed — check the DNS record and retry'))
    }
  }

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-[var(--border-1)] px-3 py-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-[var(--text-body)] text-sm'>{domain.domain}</span>
        <div className='flex items-center gap-2'>
          <ChipTag variant={domain.status === 'verified' ? 'mono' : 'gray'}>
            {domain.status === 'verified' ? 'Verified' : 'Pending'}
          </ChipTag>
          <RowActionsMenu
            label={`${domain.domain} actions`}
            actions={[{ label: 'Remove', onSelect: () => onRemove(domain), destructive: true }]}
          />
        </div>
      </div>

      {domain.status === 'pending' && domain.txtRecordValue && (
        <div className='flex flex-col gap-3'>
          <p className='text-[var(--text-muted)] text-caption'>
            Add this TXT record at your DNS provider, then verify. DNS changes can take up to 48
            hours to propagate.
          </p>
          <CopyField label='Host / name' value={domain.challengeHost} />
          <CopyField label='Value' value={domain.txtRecordValue} />
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

export function DomainSettings({ organizationId }: DomainSettingsProps) {
  const { data, isLoading } = useOrganizationDomains(organizationId)
  const addDomain = useAddOrganizationDomain()
  const removeDomain = useRemoveOrganizationDomain()

  const [newDomain, setNewDomain] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<OrganizationDomain | null>(null)

  if (isLoading) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>Loading domains...</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (data && !data.isEnterprise) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          Domain verification is available on Enterprise plans only.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

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
      <SettingsPanel>
        <div className='flex flex-col gap-7'>
          <div className='flex flex-col gap-[9px]'>
            <p className='text-[var(--text-muted)] text-caption'>
              Verify domains your organization owns. A domain must be verified before you can
              configure SSO for it.
            </p>
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
          </div>

          {domains.length === 0 ? (
            <SettingsEmptyState variant='inline'>No domains yet.</SettingsEmptyState>
          ) : (
            <div className='flex flex-col gap-3'>
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
      </SettingsPanel>

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
