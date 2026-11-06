'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationDomain } from '@/lib/api/contracts/organization'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  CopyField,
  EmptyState,
  FailureNotice,
  LoadingRows,
  StatusTag,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import { useDomainList, useDomainVerification } from '@/platform/embedded/lib/data/sso-settings'

interface DomainRowProps {
  organizationId: string
  domain: OrganizationDomain
  onRemove: (domain: OrganizationDomain) => void
}

function DomainRow({ organizationId, domain, onRemove }: DomainRowProps) {
  const verification = useDomainVerification(organizationId, domain)
  const isVerified = domain.status === 'verified'

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
            <Button
              size='compact'
              disabled={verification.pending}
              onClick={() => void verification.verify()}
            >
              {verification.pending ? 'Checking…' : 'Verify'}
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
  const {
    read,
    addPending,
    removePending,
    add: addDomain,
    remove,
  } = useDomainList(organizationId, active)
  const { data, isLoading, isError, error, isFetching, refetch } = read
  const [newDomain, setNewDomain] = useState('')
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const domains = data?.domains ?? []
  const pendingRemoval = domains.find((domain) => domain.id === pendingRemovalId) ?? null
  useSettingsUnsavedGuard({
    isDirty: newDomain.trim().length > 0,
    navigationBlocked: addPending || removePending,
    onDiscard: () => setNewDomain(''),
  })
  const canAdd = !addPending && newDomain.trim().length > 0

  async function add() {
    const value = newDomain.trim()
    if (!value) return
    await addDomain(value, () => {
      setNewDomain((current) => (current.trim() === value ? '' : current))
    })
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
                {addPending ? 'Adding…' : 'Add domain'}
              </Button>
            </ActionRow>
          </FieldStack>
        </form>
        {/* Every state but the rows sits in a padded stack, which a boundary around all of them cannot do. */}
        {isLoading ? (
          <FieldStack>
            <LoadingRows label='Loading domains…' />
          </FieldStack>
        ) : data === undefined && isError ? (
          <FieldStack>
            <FailureNotice
              message={getErrorMessage(error, 'Failed to load verified domains')}
              retrying={isFetching}
              onRetry={() => void refetch()}
            />
          </FieldStack>
        ) : domains.length === 0 ? (
          <FieldStack>
            <EmptyState title='No domains yet.' />
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
      <ConfirmDialog
        target={active && pendingRemoval !== null}
        onClose={() => setPendingRemovalId(null)}
        title='Remove domain'
        description={`Remove ${pendingRemoval?.domain ?? ''}? This immediately disables SSO sign-in for anyone on that domain, because the proof is what grants your identity provider its authority. Verifying the domain again restores it.`}
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={async () => {
          if (!pendingRemoval) return
          await remove(pendingRemoval)
        }}
      />
    </SectionStack>
  )
}
