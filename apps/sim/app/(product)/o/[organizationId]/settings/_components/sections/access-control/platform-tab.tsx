'use client'

import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  PermissionBulkSelect,
  type PermissionControls,
  PermissionGrid,
  PlatformPermissionRow,
  StatusFilter,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/permission-rows'
import { ProjectIssueRestrictions } from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/project-issue-restrictions'
import {
  CHAT_DEPLOY_AUTH_TYPE_OPTIONS,
  type EditorModel,
  FEATURE_PERMISSION_GRIDS,
  FILE_SHARE_AUTH_TYPE_OPTIONS,
  isFeatureInertForGroup,
  matchesStatusFilter,
  type PermissionStatusFilter,
  platformFeatureSections,
  searchPlatformFeatures,
} from '@/platform/lib/data/access-control'

interface PlatformTabProps {
  organizationId: string
  projectsEnabled: boolean
  isDefaultGroup: boolean
  model: EditorModel
  controls: PermissionControls
  deniedProjectIssues: string[]
  search: string
  deferredSearch: string
  status: PermissionStatusFilter
  onSearchChange: (search: string) => void
  onStatusChange: (status: PermissionStatusFilter) => void
  onDeniedProjectIssuesChange: (projectIds: string[]) => void
}

/** A feature's nested choices, for the features that govern a set of modes or connectors. */
function FeatureGrid({
  featureId,
  model,
  controls,
}: {
  featureId: string
  model: EditorModel
  controls: PermissionControls
}) {
  const kind = FEATURE_PERMISSION_GRIDS[featureId as keyof typeof FEATURE_PERMISSION_GRIDS]
  if (!kind) return null
  const connectors = kind === 'knowledge_connector'
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
      searchLabel={connectors ? 'Search connectors…' : 'Search authentication modes…'}
      emptyLabel={connectors ? 'No connectors available' : 'No modes available'}
      controls={controls}
    />
  )
}

/** Platform features by category, and the Project issues the group restricts. */
export function PlatformTab({
  organizationId,
  projectsEnabled,
  isDefaultGroup,
  model,
  controls,
  deniedProjectIssues,
  search,
  deferredSearch,
  status,
  onSearchChange,
  onStatusChange,
  onDeniedProjectIssuesChange,
}: PlatformTabProps) {
  const features = searchPlatformFeatures(deferredSearch).filter((feature) =>
    matchesStatusFilter(
      status,
      controls.getState({ kind: 'feature', configKey: feature.configKey })
    )
  )
  const sections = platformFeatureSections(features)
  const editable = features.filter(
    (feature) =>
      !isFeatureInertForGroup(feature, isDefaultGroup) &&
      !controls.isInherited({ kind: 'feature', configKey: feature.configKey })
  )
  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search features'
            placeholder='Search features…'
            value={search}
            onValueChange={onSearchChange}
          />
        }
      >
        <StatusFilter value={status} onChange={onStatusChange} />
        <PermissionBulkSelect
          targets={editable.map((feature) => ({ kind: 'feature', configKey: feature.configKey }))}
          controls={controls}
        />
      </SectionToolbar>
      {sections.length === 0 && (
        <SettingsList title='Features' empty={{ title: 'No matching features' }} />
      )}
      {sections.map(({ category, features: rows }) => (
        <SettingsSection key={category} title={category}>
          {rows.map((feature) => {
            const grid =
              FEATURE_PERMISSION_GRIDS[feature.id as keyof typeof FEATURE_PERMISSION_GRIDS]
            return (
              <PlatformPermissionRow
                key={feature.id}
                feature={feature}
                inert={isFeatureInertForGroup(feature, isDefaultGroup)}
                detailsLabel={
                  grid === 'knowledge_connector' ? 'Connectors' : 'Authentication modes'
                }
                controls={controls}
              >
                {grid && <FeatureGrid featureId={feature.id} model={model} controls={controls} />}
              </PlatformPermissionRow>
            )
          })}
        </SettingsSection>
      ))}
      <ProjectIssueRestrictions
        organizationId={organizationId}
        projectsEnabled={projectsEnabled}
        value={deniedProjectIssues}
        onChange={onDeniedProjectIssuesChange}
      />
    </SectionStack>
  )
}
