'use client'

import { useState } from 'react'
import { DataTable, TableLabel } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { usePersonalAccountsList } from '@/platform/lib/data/account'

const TITLE = 'Connected organization accounts'
const COLUMNS = [
  { key: 'name', label: 'Account', kind: 'text' },
  { key: 'service', label: 'Service', kind: 'text', showFrom: 'compact' },
  { key: 'status', label: 'Status', kind: 'status' },
] as const

type PersonalAccount = ReturnType<
  typeof usePersonalAccountsList
>['groups'][number]['accounts'][number]

/**
 * Accounts this person connected for an organization. Membership does not gate it: someone who left
 * still disconnects their own grants here, because that organization's Integrations are closed to them.
 */
export function OrganizationAccounts() {
  const list = usePersonalAccountsList()
  const [pending, setPending] = useState<PersonalAccount | null>(null)
  if (list.status === 'pending') return <SectionSkeleton title={TITLE} rows={2} />
  if (list.status === 'error')
    return (
      <FailureNotice
        message={list.error ?? 'Failed to load connected accounts'}
        onRetry={list.retry}
      />
    )
  if (list.groups.length === 0)
    return <EmptyState title='No accounts connected for an organization' />
  const last = list.groups.length - 1
  return (
    <>
      {list.groups.map((group, index) => (
        <DataTable
          key={group.id}
          title={group.name}
          columns={COLUMNS}
          loadMore={index === last ? list.loadMore : undefined}
          rows={group.accounts.map((account) => ({
            id: account.id,
            values: { name: account.name, service: account.service },
            cells: {
              service: (
                <TableLabel leading={<Icon providerId={account.providerId} />}>
                  {account.service}
                </TableLabel>
              ),
              status: account.status ? <StatusTag label={account.status} intent='warning' /> : null,
            },
            action: account.canDisconnect ? (
              <ActionMenu
                label={`${account.name} actions`}
                icon='I108'
                align='end'
                actions={[
                  {
                    id: 'disconnect',
                    label: 'Disconnect',
                    destructive: true,
                    onSelect: () => setPending(account),
                  },
                ]}
              />
            ) : undefined,
          }))}
        />
      ))}
      <Modal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        variant='confirm'
        destructive
        title='Disconnect account'
        confirmLabel='Disconnect'
        description={`Disconnecting ${pending?.name ?? 'this account'} removes it from ${pending?.organizationName ?? 'the organization'}. Workflows using this account will lose access.`}
        onConfirm={() =>
          pending ? list.disconnect(pending.id, pending.organizationId, pending.name) : undefined
        }
      />
    </>
  )
}
