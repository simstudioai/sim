'use client'

import { type ReactNode, useState } from 'react'
import {
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import type { ConnectorMeta } from '@/connectors/types'

interface AddOrganizationSourceModalProps {
  sources: {
    type: string
    meta: ConnectorMeta
    access: { admin: boolean; members: boolean }
  }[]
  pending: boolean
  ready: boolean
  feedback: ReactNode
  onClose: () => void
  onSelect: (type: string, accessMode: 'admin' | 'members') => void
}

export function AddOrganizationSourceModal({
  sources,
  pending,
  ready,
  feedback,
  onClose,
  onSelect,
}: AddOrganizationSourceModalProps) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const visible = sources.filter(({ meta }) => meta.name.toLowerCase().includes(query))

  return (
    <ChipModal
      open
      dismissDisabled={pending}
      onOpenChange={(open) => !open && onClose()}
      srTitle='Add source'
    >
      <ChipModalHeader onClose={onClose}>Add source</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Find a source' submitOnEnter={false}>
          <ChipInput
            icon={Search}
            placeholder='Search sources...'
            aria-label='Find a source'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={pending}
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Sources'>
          {feedback}
          <div className={RESOURCE_LIST_STACK}>
            {visible.map(({ type, meta, access }) => {
              const available = access.admin || access.members
              return (
                <SettingsResourceRow
                  key={type}
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={meta.name}
                  description={
                    !ready
                      ? 'Checking availability…'
                      : !available
                        ? 'Unavailable in this deployment'
                        : access.admin
                          ? meta.auth.mode === 'apiKey'
                            ? 'Connect an API token'
                            : meta.auth.mode === 'oauth' &&
                                meta.auth.adminCredentialType === 'service_account'
                              ? 'Connect a service account'
                              : 'Connect an admin account'
                          : type === 'slack'
                            ? 'Set up your Slack app'
                            : 'Connect member accounts'
                  }
                  disabled={pending || !ready || !available}
                  onClick={() => onSelect(type, access.admin ? 'admin' : 'members')}
                  clickLabel={`Set up ${meta.name}`}
                  navigable={ready && available}
                />
              )
            })}
            {visible.length === 0 && (
              <SettingsEmptyState variant='inline'>No matching sources</SettingsEmptyState>
            )}
          </div>
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter onCancel={onClose} defaultAction='dismiss' />
    </ChipModal>
  )
}
