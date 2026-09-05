'use client'

import { Chip } from '@sim/emcn'
import dynamic from 'next/dynamic'
import { useQueryState } from 'nuqs'
import { useSession } from '@/lib/auth/auth-client'
import { MANAGED_SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  managedSourceParam,
  searchSetupParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
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

const SearchSourceStatus = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/search/components/search-source-status').then(
      (module) => module.SearchSourceStatus
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
  const { data: session } = useSession()
  const [selectedType, setSelectedType] = useQueryState(
    searchSetupParam.key,
    searchSetupParam.parser.withOptions({ history: 'replace' })
  )
  const [managedType, setManagedType] = useQueryState(
    managedSourceParam.key,
    managedSourceParam.parser.withOptions({ history: 'replace' })
  )
  const prepare = usePrepareSearchSource()
  const bases = useKnowledgeBasesQuery(workspaceId, { enabled: canAdmin && available })
  const existingBase = bases.data?.find((base) => base.isSearchIndex === true)
  const knowledgeBaseId = existingBase?.id
  const connectors = useConnectorList(canAdmin && available ? knowledgeBaseId : undefined)
  const visible = MANAGED_SEARCH_CONNECTORS.filter(({ meta }) =>
    `${meta.name} ${meta.description}`.toLowerCase().includes(search)
  )
  if (visible.length === 0 && selectedType === null && !managedType) return null
  const failedQuery = bases.isError
    ? bases
    : knowledgeBaseId && connectors.isError
      ? connectors
      : null
  if (canAdmin && available && failedQuery) {
    return (
      <IntegrationSection label='Workspace sources' layout='list'>
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
    <IntegrationSection
      label='Workspace sources'
      layout='list'
      description='For admins setting up search for a team. Connect an administrator or service account to sync content and its permissions. Each person sees only documents they can access in the source.'
    >
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
                    <Chip
                      onClick={() => void setManagedType(managedSourceParam.parser.parse(type))}
                    >
                      Manage
                    </Chip>
                  )}
                  <Chip
                    variant='primary'
                    disabled={
                      prepare.isPending ||
                      bases.isPending ||
                      Boolean(knowledgeBaseId && connectors.isPending)
                    }
                    onClick={() => {
                      if (knowledgeBaseId) void setSelectedType(searchSetupParam.parser.parse(type))
                      else
                        prepare.mutate(
                          { workspaceId, connectorType: type },
                          {
                            onSuccess: () =>
                              void setSelectedType(searchSetupParam.parser.parse(type)),
                          }
                        )
                    }}
                  >
                    {configured.length ? 'Add source' : 'Set up'}
                  </Chip>
                </div>
              ) : undefined
            }
          />
        )
      })}
      {canAdmin && available && prepare.error && (
        <p className='text-[var(--text-error)] text-caption'>{prepare.error.message}</p>
      )}
      {canAdmin && available && selectedType && !knowledgeBaseId && !bases.isPending && (
        <Chip
          disabled={prepare.isPending}
          onClick={() =>
            prepare.mutate({
              workspaceId,
              connectorType: selectedType,
              ...(selectedType === 'slack' && { accessMode: 'members' }),
            })
          }
        >
          Continue setup
        </Chip>
      )}
      {canAdmin && available && selectedType !== null && knowledgeBaseId && session?.user?.id && (
        <AddConnectorModal
          key={`${session.user.id}:${knowledgeBaseId}:${selectedType}`}
          open
          onOpenChange={(open) => {
            if (!open) void setSelectedType(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex
          initialConnectorType={selectedType}
          initialAccessMode={selectedType === 'slack' ? 'members' : 'admin'}
          setupDraftKey={`${session.user.id}:${workspaceId}:${knowledgeBaseId}:${selectedType}`}
          onConnectorTypeChange={(type) =>
            void setSelectedType(type !== null ? searchSetupParam.parser.parse(type) : null)
          }
          onCreated={(type) => void setManagedType(managedSourceParam.parser.parse(type))}
        />
      )}
      {canAdmin && available && managedType && knowledgeBaseId && (
        <SearchSourceStatus
          workspaceId={workspaceId}
          knowledgeBaseId={knowledgeBaseId}
          connectorType={managedType}
          connectors={
            connectors.data?.filter((connector) => connector.connectorType === managedType) ?? []
          }
          isLoading={connectors.isPending}
          onClose={() => void setManagedType(null)}
        />
      )}
    </IntegrationSection>
  )
}
