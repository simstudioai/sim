'use client'

import { useDeferredValue } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { ProviderMark } from '@/platform/app/(shell)/_components/provider-mark/provider-mark'
import {
  FieldStack,
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  BlockToolRow,
  PermissionBulkSelect,
  type PermissionControls,
  PermissionGrid,
  PlatformPermissionRow,
  ProviderRow,
} from '@/platform/app/(shell)/settings/_components/sections/access-control/permission-rows'
import { ProjectIssueRestrictions } from '@/platform/app/(shell)/settings/_components/sections/access-control/project-issue-restrictions'
import {
  FailureNotice,
  LoadingRows,
  SearchableSelect,
  SectionSearch,
  Select,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  type AccessRequestTarget,
  agentDefaultModelIds,
  CHAT_DEPLOY_AUTH_TYPE_OPTIONS,
  type EditorModel,
  FEATURE_PERMISSION_GRIDS,
  FILE_SHARE_AUTH_TYPE_OPTIONS,
  isAgentDefaultUsable,
  isFeatureInertForGroup,
  matchesStatusFilter,
  type PermissionGroupConfig,
  type PermissionStatusFilter,
  PLATFORM_DEFAULT_MODEL,
  platformFeatureSections,
  SIM_AUTO_MODEL_ID,
  searchPlatformFeatures,
  statusFilterOptions,
  type useGroupDetailParams,
  type usePermissionEditorModel,
  useProviderModelLists,
} from '@/platform/lib/data/access-control'

function StatusFilterSelect({
  value,
  onChange,
}: {
  value: PermissionStatusFilter
  onChange: (value: PermissionStatusFilter) => void
}) {
  return (
    <Select
      label='Filter by access'
      variant='quiet'
      value={value}
      options={statusFilterOptions(value)}
      onValueChange={(next) => onChange(next as PermissionStatusFilter)}
    />
  )
}

interface AgentDefaultProps {
  config: PermissionGroupConfig
  model: EditorModel
  hosted: boolean
  onChange: (value: string | null) => void
}

function modelMark(model: EditorModel, id: string) {
  const provider = model.facts.findProvider(id)
  return provider ? <ProviderMark providerId={provider} /> : undefined
}

/** An allowed default for new Agent blocks governed by this group. */
function AgentDefault({ config, model, hosted, onChange }: AgentDefaultProps) {
  const dynamicModels = useProviderModelLists(
    model.dynamicProviderIds.filter((provider) =>
      model.providerIds.includes(provider)
    ) as Parameters<typeof useProviderModelLists>[0],
    undefined
  )
  const { autoAllowed, models } = agentDefaultModelIds({
    config,
    providerIds: model.providerIds,
    staticModels: model.providerModels,
    dynamicModels,
    hosted,
    facts: model.facts,
  })
  const saved = config.defaultAgentModel
  const options = [
    { label: 'Platform default', value: PLATFORM_DEFAULT_MODEL },
    ...(autoAllowed ? [{ label: 'Auto', value: SIM_AUTO_MODEL_ID }] : []),
    ...models.map((id) => ({ label: id, value: id, leading: modelMark(model, id) })),
  ]
  const usable = isAgentDefaultUsable(
    config,
    { hosted, providerIds: model.providerIds },
    model.facts
  )
  return (
    <SearchableSelect
      label='Agent default'
      searchLabel='Select a model'
      placeholder='Select a model'
      options={options}
      value={saved ?? PLATFORM_DEFAULT_MODEL}
      selectedLabel={saved === SIM_AUTO_MODEL_ID ? 'Auto' : (saved ?? 'Platform default')}
      selectedLeading={saved ? modelMark(model, saved) : undefined}
      error={usable ? undefined : 'Agent default must be an available, allowed model'}
      onValueChange={(next) => {
        if (next) onChange(next === PLATFORM_DEFAULT_MODEL ? null : next)
      }}
    />
  )
}

type GroupDetailParams = ReturnType<typeof useGroupDetailParams>
type PermissionEditor = ReturnType<typeof usePermissionEditorModel>

interface CatalogTabProps {
  params: GroupDetailParams
  query: string
  model: EditorModel
  controls: PermissionControls
}

interface ProvidersTabProps extends CatalogTabProps {
  providers: PermissionEditor['providers']
  config: PermissionGroupConfig
  hosted: boolean
  onConfigChange: (patch: Partial<PermissionGroupConfig>) => void
}

function ProvidersTab({
  params,
  query,
  model,
  controls,
  providers,
  config,
  hosted,
  onConfigChange,
}: ProvidersTabProps) {
  const { search, status } = params
  /** Only this tab depends on what the deployment blacklists; it never lists providers unread. */
  if (providers.failed) {
    return (
      <FailureNotice
        message={getErrorMessage(providers.error, 'Could not load provider availability')}
        retrying={providers.retrying}
        onRetry={providers.retry}
      />
    )
  }
  if (providers.pending) return <LoadingRows label='Loading providers' />
  const filtered = model.providerIds
    .filter((id) => !query || id.toLowerCase().includes(query))
    .filter((id) => matchesStatusFilter(status, controls.getState({ kind: 'provider', id })))
  return (
    <SectionStack>
      <SettingsSection title='Agent default'>
        <FieldStack>
          <AgentDefault
            config={config}
            model={model}
            hosted={hosted}
            onChange={(defaultAgentModel) => onConfigChange({ defaultAgentModel })}
          />
        </FieldStack>
      </SettingsSection>
      <SectionToolbar
        grow={
          <SectionSearch
            subject='providers'
            key='providers'
            value={search}
            onValueChange={params.setSearch}
          />
        }
      >
        <StatusFilterSelect value={status} onChange={params.setStatus} />
        <PermissionBulkSelect
          targets={filtered.map((id) => ({ kind: 'provider', id }))}
          controls={controls}
        />
      </SectionToolbar>
      {filtered.length === 0 ? (
        <Muted>No providers match your filters.</Muted>
      ) : (
        <SettingsSection title='Providers'>
          {filtered.map((providerId) => (
            <ProviderRow
              key={providerId}
              providerId={providerId}
              model={model}
              controls={controls}
            />
          ))}
        </SettingsSection>
      )}
    </SectionStack>
  )
}

function BlocksTab({ params, query, model, controls }: CatalogTabProps) {
  const { search, status } = params
  const filtered = model.visibleBlocks
    .filter((block) => !query || block.name.toLowerCase().includes(query))
    .filter((block) =>
      matchesStatusFilter(status, controls.getState({ kind: 'integration', id: block.type }))
    )
  const core = filtered.filter((block) => block.category === 'blocks')
  const tools = filtered
    .filter((block) => block.category === 'tools' || block.category === 'triggers')
    .sort((a, b) => a.name.localeCompare(b.name))
  const targets = (list: typeof filtered): AccessRequestTarget[] =>
    list.map((block) => ({ kind: 'integration', id: block.type }))
  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SectionSearch
            subject='blocks'
            key='blocks'
            value={search}
            onValueChange={params.setSearch}
          />
        }
      >
        <StatusFilterSelect value={status} onChange={params.setStatus} />
      </SectionToolbar>
      {core.length === 0 && tools.length === 0 && <Muted>No blocks match your filters.</Muted>}
      {core.length > 0 && (
        <SettingsSection title='Core Blocks'>
          <SettingsRow label='All core blocks'>
            <PermissionBulkSelect targets={targets(core)} controls={controls} />
          </SettingsRow>
          {core.map((block) => (
            <BlockToolRow key={block.type} block={block} controls={controls} />
          ))}
        </SettingsSection>
      )}
      {tools.length > 0 && (
        <SettingsSection title='Integrations and Triggers'>
          <SettingsRow
            label='All integrations and triggers'
            description='Choose access for an integration, then expand it to set individual tools. Parent restrictions apply to every tool.'
          >
            <PermissionBulkSelect targets={targets(tools)} controls={controls} />
          </SettingsRow>
          {tools.map((block) => (
            <BlockToolRow key={block.type} block={block} controls={controls} />
          ))}
        </SettingsSection>
      )}
    </SectionStack>
  )
}

interface PlatformTabProps extends CatalogTabProps {
  deferredSearch: string
  isDefault: boolean
  organizationId: string
  projectsEnabled: boolean
  config: PermissionGroupConfig
  onConfigChange: (patch: Partial<PermissionGroupConfig>) => void
}

function PlatformTab({
  params,
  deferredSearch,
  model,
  controls,
  isDefault,
  organizationId,
  projectsEnabled,
  config,
  onConfigChange,
}: PlatformTabProps) {
  const { search, status } = params
  const features = searchPlatformFeatures(deferredSearch).filter((feature) =>
    matchesStatusFilter(
      status,
      controls.getState({ kind: 'feature', configKey: feature.configKey })
    )
  )
  const sections = platformFeatureSections(features)
  const editable = features.filter(
    (feature) =>
      !isFeatureInertForGroup(feature, isDefault) &&
      !controls.isInherited({ kind: 'feature', configKey: feature.configKey })
  )
  const gridFor = (featureId: string) => {
    const kind = FEATURE_PERMISSION_GRIDS[featureId as keyof typeof FEATURE_PERMISSION_GRIDS]
    if (!kind) return undefined
    const items =
      kind === 'chat_deploy_auth'
        ? CHAT_DEPLOY_AUTH_TYPE_OPTIONS
        : kind === 'file_share_auth'
          ? FILE_SHARE_AUTH_TYPE_OPTIONS
          : model.knowledgeConnectors
    return (
      <PermissionGrid
        items={items.map(({ value, label }) => ({ id: value, label }))}
        kind={kind}
        searchLabel={
          kind === 'knowledge_connector' ? 'Search connectors…' : 'Search authentication modes…'
        }
        emptyLabel={
          kind === 'knowledge_connector' ? 'No connectors available.' : 'No modes available.'
        }
        controls={controls}
      />
    )
  }
  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SectionSearch
            subject='features'
            key='platform'
            value={search}
            onValueChange={params.setSearch}
          />
        }
      >
        <StatusFilterSelect value={status} onChange={params.setStatus} />
        <PermissionBulkSelect
          targets={editable.map((feature) => ({ kind: 'feature', configKey: feature.configKey }))}
          controls={controls}
        />
      </SectionToolbar>
      {sections.length === 0 && <Muted>No features match your filters.</Muted>}
      {sections.map(({ category, features: rows }) => (
        <SettingsSection key={category} title={category}>
          {rows.map((feature) => (
            <PlatformPermissionRow
              key={feature.id}
              feature={feature}
              inert={isFeatureInertForGroup(feature, isDefault)}
              controls={controls}
            >
              {gridFor(feature.id)}
            </PlatformPermissionRow>
          ))}
        </SettingsSection>
      ))}
      <ProjectIssueRestrictions
        organizationId={organizationId}
        projectsEnabled={projectsEnabled}
        value={config.deniedPartialAccessProjectIssues}
        onChange={(deniedPartialAccessProjectIssues) =>
          onConfigChange({ deniedPartialAccessProjectIssues })
        }
      />
    </SectionStack>
  )
}

interface GroupCatalogTabProps {
  params: GroupDetailParams
  editor: PermissionEditor
  controls: PermissionControls | null
  config: PermissionGroupConfig
  isDefault: boolean
  hosted: boolean
  organizationId: string
  projectsEnabled: boolean
  onConfigChange: (patch: Partial<PermissionGroupConfig>) => void
}

/** The permission catalog under one tab, filtered by the tab's search and access filter. */
export function GroupCatalogTab({
  params,
  editor,
  controls,
  config,
  isDefault,
  hosted,
  organizationId,
  projectsEnabled,
  onConfigChange,
}: GroupCatalogTabProps) {
  const deferredSearch = useDeferredValue(params.search)
  const query = deferredSearch.trim().toLowerCase()
  const { model } = editor
  if (!model || !controls) {
    return (
      <FailureNotice
        message='Could not load the block catalog'
        retrying={false}
        onRetry={editor.retryCatalog}
      />
    )
  }
  const shared = { params, query, model, controls }
  if (params.tab === 'providers') {
    return (
      <ProvidersTab
        {...shared}
        providers={editor.providers}
        config={config}
        hosted={hosted}
        onConfigChange={onConfigChange}
      />
    )
  }
  if (params.tab === 'blocks') return <BlocksTab {...shared} />
  return (
    <PlatformTab
      {...shared}
      deferredSearch={deferredSearch}
      isDefault={isDefault}
      organizationId={organizationId}
      projectsEnabled={projectsEnabled}
      config={config}
      onConfigChange={onConfigChange}
    />
  )
}
