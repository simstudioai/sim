'use client'

import { lazy, Suspense, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  customToolIdParam,
  customToolIdUrlKeys,
  useCustomTools,
  useSettingsSearch,
} from '@/platform/lib/data/custom-tools'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

/**
 * The editor reaches the code generation and secret tooling, which carry the workflow editor's
 * logic, so it loads when a tool opens and the list does not download it.
 */
const CustomToolDetail = lazy(() =>
  import(
    '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-tools/custom-tool-detail'
  ).then((module) => ({ default: module.CustomToolDetail }))
)

/** The workspace's custom agent tools: a searchable list, each opening its schema and code. */
export default function CustomToolsSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canEdit } = useWorkspaceSettingsSection(workspaceId, 'custom-tools')
  const tools = useCustomTools(workspaceId)
  // Placeholder data is another workspace's tools reading as success, so it counts as loading.
  const loading = tools.isPending || tools.isPlaceholderData
  const [search, setSearch] = useSettingsSearch()
  const [selectedToolId, setSelectedToolId] = useQueryState(customToolIdParam.key, {
    ...customToolIdParam.parser,
    ...customToolIdUrlKeys,
  })
  /** The create flow has no entity id and is not deep-linkable, so it stays local. */
  const [creating, setCreating] = useState(false)
  const list = loading ? [] : (tools.data ?? [])
  const selected = selectedToolId ? list.find((tool) => tool.id === selectedToolId) : undefined

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (selectedToolId !== null && loading) return null

  const closeDetail = () => {
    setCreating(false)
    void setSelectedToolId(null, { history: 'replace' })
  }

  if ((creating && canEdit) || selected) {
    return (
      <Suspense fallback={null}>
        <CustomToolDetail
          key={creating ? 'new' : selected?.id}
          workspaceId={workspaceId}
          tool={creating ? null : (selected ?? null)}
          readOnly={!canEdit}
          onBack={closeDetail}
          onCreated={(toolId) => {
            setCreating(false)
            void setSelectedToolId(toolId)
          }}
        />
      </Suspense>
    )
  }

  const term = search.trim().toLowerCase()
  const filtered = list.filter(
    (tool) =>
      !term ||
      tool.title.toLowerCase().includes(term) ||
      tool.schema?.function?.name?.toLowerCase().includes(term) ||
      tool.schema?.function?.description?.toLowerCase().includes(term)
  )

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SectionToolbar
        grow={
          <SearchField
            label='Search tools'
            placeholder='Search tools…'
            value={search}
            onValueChange={setSearch}
          />
        }
      >
        {canEdit && (
          <Button
            variant='primary'
            size='compact'
            icon='I074'
            disabled={loading}
            onClick={() => setCreating(true)}
          >
            Add tool
          </Button>
        )}
      </SectionToolbar>
      {tools.error ? (
        <FailureNotice
          message={getErrorMessage(tools.error, 'Failed to load tools')}
          retrying={tools.isFetching}
          onRetry={() => void tools.refetch()}
        />
      ) : loading ? null : list.length === 0 ? (
        <EmptyState
          title={canEdit ? 'No custom tools yet' : 'No custom tools configured'}
          description={canEdit ? 'Add a tool to get started.' : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title='No matching tools' />
      ) : (
        <SettingsSection title='Tools'>
          <ResourceList>
            {filtered.map((tool) => (
              <ActivityRow
                key={tool.id}
                density='comfortable'
                leading={<Icon name='I127' />}
                title={tool.title || 'Unnamed tool'}
                detail={tool.schema?.function?.description || undefined}
                onOpen={() => void setSelectedToolId(tool.id)}
              />
            ))}
          </ResourceList>
        </SettingsSection>
      )}
    </SectionStack>
  )
}
