'use client'

import { ChipConfirmModal, ChipModalError } from '@sim/emcn'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { useUpdateOrganizationAccounts } from '@/hooks/queries/organization-accounts'

interface OrganizationSlackAccountRemovalProps {
  organizationId: string
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
  onClose: () => void
  onRemoved: () => void
}

export function OrganizationSlackAccountRemoval({
  organizationId,
  group,
  onClose,
  onRemoved,
}: OrganizationSlackAccountRemovalProps) {
  const update = useUpdateOrganizationAccounts()
  return (
    <ChipConfirmModal
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose()
      }}
      title='Remove Slack app setup?'
      text='This disconnects your organization’s Slack accounts and clears their saved app configuration. Remove any connections using these accounts first.'
      confirm={{
        label: 'Remove',
        variant: 'destructive',
        pending: update.isPending,
        onClick: () =>
          update.mutate(
            {
              organizationId,
              groupId: group.id,
              update: {
                options: group.options
                  .filter((option) => option.provider !== 'slack')
                  .map(({ id, provider, label, required }) => ({ id, provider, label, required })),
              },
            },
            { onSuccess: onRemoved }
          ),
      }}
    >
      <ChipModalError>{update.error?.message}</ChipModalError>
    </ChipConfirmModal>
  )
}
