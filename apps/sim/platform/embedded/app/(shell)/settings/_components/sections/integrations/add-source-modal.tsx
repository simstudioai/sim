'use client'

import type { ComponentType, ReactNode } from 'react'
import {
  ActivityRow,
  Avatar,
  EmptyState,
  Modal,
  RowList,
} from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { GENERIC_SECRETS_SOURCE_TYPE } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/generic-secrets'

interface SourceMarkProps {
  organization: AddSourceModalProps['organization']
  type: string
  icon?: ComponentType<{ className?: string }>
}

interface AddSourceModalProps {
  organization: { name: string; logo?: string | null }
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

function SourceMark({ organization, type, icon }: SourceMarkProps) {
  return type === GENERIC_SECRETS_SOURCE_TYPE ? (
    <Avatar name={organization.name} src={organization.logo ?? undefined} organization />
  ) : (
    <IntegrationMark providerId={type} icon={icon} />
  )
}

export function AddSourceModal({
  organization,
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
      confirmLabel='Done'
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
            <li key={type}>
              <SettingsRow
                label={name}
                description={description}
                leading={<SourceMark organization={organization} type={type} icon={icon} />}
              />
            </li>
          ) : (
            <ActivityRow
              density='comfortable'
              key={type}
              leading={<SourceMark organization={organization} type={type} icon={icon} />}
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
