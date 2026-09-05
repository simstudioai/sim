'use client'

import { useState } from 'react'
import { Button, ChipLink } from '@sim/emcn'
import dynamic from 'next/dynamic'
import { MANAGED_SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useConnectorList, usePrepareSearchSource } from '@/hooks/queries/kb/connectors'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'

const AddConnectorModal = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal').then(
      (module) => module.AddConnectorModal
    ),
  { ssr: false }
)

interface ManagedSearchSourcesProps {
  workspaceId: string
  canAdmin: boolean
  available: boolean
  search: string
}

/** Source-managed access uses the platform's connector setup and status controls. */
export function ManagedSearchSources({
  workspaceId,
  canAdmin,
  available,
  search,
}: ManagedSearchSourcesProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const prepare = usePrepareSearchSource()
  const bases = useKnowledgeBasesQuery(workspaceId, { enabled: canAdmin && available })
  const existingBase = bases.data?.find((base) => base.isSearchIndex === true)
  const knowledgeBaseId = existingBase?.id
  const connectors = useConnectorList(canAdmin && available ? knowledgeBaseId : undefined)
  const visible = MANAGED_SEARCH_CONNECTORS.filter(({ meta }) =>
    `${meta.name} ${meta.description}`.toLowerCase().includes(search)
  )
  if (visible.length === 0) return null
  const failedQuery = bases.isError
    ? bases
    : knowledgeBaseId && connectors.isError
      ? connectors
      : null
  if (canAdmin && available && failedQuery) {
    return (
      <IntegrationSection label='Workspace sources'>
        <SettingsQueryErrorState
          error={failedQuery.error}
          fallback='Failed to load workspace sources'
          isRetrying={failedQuery.isFetching}
          onRetry={() => void failedQuery.refetch()}
          variant='inline'
        />
      </IntegrationSection>
    )
  }
  return (
    <IntegrationSection label='Workspace sources'>
      {visible.map(({ type, meta }) => {
        const configured =
          (canAdmin && available ? connectors.data : undefined)?.filter(
            (connector) => connector.connectorType === type && connector.accessMode === 'admin'
          ) ?? []
        const statuses = [...new Set(configured.map((connector) => connector.status))].join(', ')
        const hint = !available
          ? 'Shared source setup is not available in this workspace.'
          : !canAdmin
            ? 'Ask a workspace admin to connect this source.'
            : type === 'gitlab'
              ? 'Self-managed GitLab. Requires an instance administrator token with read_api access.'
              : 'Connect an administrator or service account. Each person keeps their access to the source.'
        return (
          <SettingsResourceRow
            key={type}
            iconVariant='custom'
            icon={<IntegrationTile blockType={type} icon={meta.icon} />}
            title={meta.name}
            description={
              configured.length
                ? `${configured.length} source${configured.length === 1 ? '' : 's'} connected · ${statuses}`
                : hint
            }
            trailing={
              canAdmin && available ? (
                <div className='flex items-center gap-2'>
                  {configured.length > 0 && knowledgeBaseId && (
                    <ChipLink href={`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`}>
                      Manage
                    </ChipLink>
                  )}
                  <Button
                    variant='primary'
                    size='sm'
                    disabled={
                      prepare.isPending ||
                      bases.isPending ||
                      Boolean(knowledgeBaseId && connectors.isPending)
                    }
                    onClick={() => {
                      if (knowledgeBaseId) setSelectedType(type)
                      else
                        prepare.mutate(
                          { workspaceId, connectorType: type },
                          { onSuccess: () => setSelectedType(type) }
                        )
                    }}
                  >
                    {configured.length ? 'Add source' : 'Set up'}
                  </Button>
                </div>
              ) : undefined
            }
          />
        )
      })}
      {canAdmin && available && prepare.error && (
        <p className='text-[var(--text-error)] text-caption'>{prepare.error.message}</p>
      )}
      {canAdmin && available && selectedType && knowledgeBaseId && (
        <AddConnectorModal
          key={selectedType}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedType(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex
          initialConnectorType={selectedType}
          initialAccessMode='admin'
          initialSyncIntervalMinutes={60}
        />
      )}
    </IntegrationSection>
  )
}
