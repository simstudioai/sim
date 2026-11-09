'use client'

import type { ReactNode } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { RowList } from '@sim/emcn/settings-section/row-list'
import { GENERIC_SECRETS_SOURCE_TYPE } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/generic-secrets'

interface AddSourceModalProps {
  sources: {
    type: string
    name: string
    access: { admin: boolean; members: boolean }
    availabilityStatus?: 'loading' | 'error'
  }[]
  pending: boolean
  ready: boolean
  feedback: ReactNode
  onClose: () => void
  onSelect: (type: string, accessMode: 'admin' | 'members') => void
  descriptions: Readonly<Record<string, string>>
}

/** Generic Secrets has no provider, so it takes the same mark the Integrations list gives it. */
const mark = (type: string) =>
  type === GENERIC_SECRETS_SOURCE_TYPE ? <Icon name='I070' /> : <Icon providerId={type} />

export function AddSourceModal({
  sources,
  pending,
  ready,
  feedback,
  onClose,
  onSelect,
  descriptions,
}: AddSourceModalProps) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title='Add source'
      cancelLabel='Close'
      submitOnEnter={false}
    >
      {feedback}
      <RowList>
        {sources.map(({ type, name, access, availabilityStatus }) => {
          const available = access.admin || access.members
          const sourceReady = ready && !availabilityStatus
          const description =
            availabilityStatus === 'error'
              ? 'Could not check availability'
              : !sourceReady
                ? 'Checking availability'
                : !available
                  ? 'Unavailable in this deployment'
                  : descriptions[type]
          return pending || !sourceReady || !available ? (
            <ActivityRow
              readOnly
              density='comfortable'
              key={type}
              leading={mark(type)}
              title={name}
              detail={description}
            />
          ) : (
            <ActivityRow
              density='comfortable'
              key={type}
              leading={mark(type)}
              title={name}
              detail={description}
              onOpen={() => onSelect(type, access.admin ? 'admin' : 'members')}
            />
          )
        })}
        {sources.length === 0 && <EmptyState title='No matching sources' />}
      </RowList>
    </Modal>
  )
}
