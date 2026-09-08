'use client'

import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { getCredentialGroupIndexingConnector } from '@/lib/credential-groups/indexing'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { OrganizationAccountIndexing } from '@/ee/credential-groups/components/organization-account-indexing'

interface OrganizationAccountProviderModalProps {
  organizationId: string
  option: NonNullable<OrganizationAccountsSettings['credentialGroup']>['options'][number]
  sources: SearchSourceSummary[]
  sourcesPending: boolean
  sourcesError: string | undefined
  indexingAvailable: boolean
  onClose: () => void
  onSetupSlack: () => void
  onSetupIndexing: (connectorType: string) => void
  onEditSource: (connectorId: string) => void
}

export function OrganizationAccountProviderModal({
  organizationId,
  option,
  sources,
  sourcesPending,
  sourcesError,
  indexingAvailable,
  onClose,
  onSetupSlack,
  onSetupIndexing,
  onEditSource,
}: OrganizationAccountProviderModalProps) {
  const service = getCredentialGroupProviderService(option.provider)
  const connector = getCredentialGroupIndexingConnector(option.provider)
  const ready = option.configurationStatus === 'ready'
  return (
    <ChipModal
      open
      srTitle={`Configure ${service.name}`}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ChipModalHeader icon={service.icon} onClose={onClose}>
        Configure {service.name}
      </ChipModalHeader>
      <ChipModalBody>
        {option.provider === 'slack' && (
          <ChipModalField
            type='custom'
            title='Slack app'
            hint='Authorizes personal Slack accounts. Workspace bots are configured separately.'
          >
            <Chip onClick={onSetupSlack}>{ready ? 'Configure app' : 'Set up app'}</Chip>
          </ChipModalField>
        )}
        {connector && (
          <>
            <ChipModalField
              type='custom'
              title='Indexing'
              hint={
                !ready
                  ? 'Complete app setup before enabling indexing.'
                  : 'Sync into Search. Turning indexing off pauses syncing and keeps indexed documents.'
              }
            >
              <OrganizationAccountIndexing
                organizationId={organizationId}
                optionId={option.id}
                providerName={service.name}
                sources={sources}
                available={indexingAvailable}
                disabled={sourcesPending || Boolean(sourcesError) || !ready}
                onSetup={() => onSetupIndexing(connector.type)}
              />
              {sourcesPending && (
                <p role='status' className='text-[var(--text-muted)] text-caption'>
                  Loading indexing settings…
                </p>
              )}
            </ChipModalField>
            {sources.length > 0 && (
              <ChipModalField type='custom' title='Sources'>
                {sources.map((source) => (
                  <SettingsResourceRow
                    key={source.connectorId}
                    title={source.sourceDescription || service.name}
                    description={source.enabled ? 'Indexing on' : 'Indexing off'}
                    trailing={
                      <Chip
                        disabled={!indexingAvailable || Boolean(sourcesError)}
                        onClick={() => onEditSource(source.connectorId)}
                      >
                        Source settings
                      </Chip>
                    }
                  />
                ))}
              </ChipModalField>
            )}
            <ChipModalError>{sourcesError}</ChipModalError>
          </>
        )}
      </ChipModalBody>
      <ChipModalFooter hideCancel primaryAction={{ label: 'Done', onClick: onClose }} />
    </ChipModal>
  )
}
