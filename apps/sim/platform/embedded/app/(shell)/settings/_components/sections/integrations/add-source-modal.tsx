'use client'

import type { ComponentType, ReactNode } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { Modal } from '@sim/emcn/modal'
import { RowList } from '@sim/emcn/settings-section/row-list'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'
import { GENERIC_SECRETS_SOURCE_TYPE } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/generic-secrets'

interface AddSourceModalProps {
  sources: {
    type: string
    name: string
    icon?: ComponentType<{ className?: string }>
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
const markId = (type: string) => (type === GENERIC_SECRETS_SOURCE_TYPE ? undefined : type)

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
        {sources.map(({ type, name, icon, access, availabilityStatus }) => {
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
              leading={<IntegrationMark providerId={markId(type)} icon={icon} />}
              title={name}
              detail={description}
            />
          ) : (
            <ActivityRow
              density='comfortable'
              key={type}
              leading={<IntegrationMark providerId={markId(type)} icon={icon} />}
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
