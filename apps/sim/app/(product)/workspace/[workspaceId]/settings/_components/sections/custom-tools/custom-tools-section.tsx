'use client'

import { lazy, Suspense } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  customToolIdParam,
  useCustomTools,
  useSettingsSearch,
} from '@/platform/lib/data/custom-tools'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
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
  const subview = useSettingsSubview({
    idParam: customToolIdParam.key,
    createParam: 'create-custom-tool',
  })
  const list = loading ? [] : (tools.data ?? [])
  const selected = subview.id ? list.find((tool) => tool.id === subview.id) : undefined

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (subview.id !== null && loading) return null

  if ((subview.creating && canEdit) || selected) {
    return (
      <Suspense fallback={null}>
        <CustomToolDetail
          key={subview.creating ? 'new' : selected?.id}
          workspaceId={workspaceId}
          tool={subview.creating ? null : (selected ?? null)}
          readOnly={!canEdit}
          onBack={subview.close}
          onCreated={subview.showCreated}
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

  const createTool = canEdit ? (
    <Button size='compact' icon='I074' onClick={subview.create}>
      Create tool
    </Button>
  ) : undefined

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SettingsRead query={tools} failureMessage='Couldn’t load custom tools'>
        {() =>
          loading ? null : (
            <>
              {list.length > 0 && (
                <SectionToolbar
                  grow={
                    <SearchField
                      label='Search tools'
                      placeholder='Search tools…'
                      value={search}
                      onValueChange={setSearch}
                    />
                  }
                />
              )}
              <SettingsList
                title='Workspace tools'
                empty={
                  list.length === 0
                    ? {
                        title: 'No custom tools yet',
                        description: canEdit ? 'Build a tool your agents can call' : undefined,
                        action: createTool,
                      }
                    : filtered.length === 0
                      ? { title: 'No matching tools' }
                      : undefined
                }
              >
                <ResourceList>
                  {filtered.map((tool) => (
                    <ActivityRow
                      key={tool.id}
                      density='comfortable'
                      leading={<Icon name='I127' />}
                      title={tool.title || 'Unnamed tool'}
                      detail={tool.schema?.function?.description || undefined}
                      onOpen={() => subview.open(tool.id)}
                    />
                  ))}
                </ResourceList>
                {createTool && (
                  <SettingsRow
                    label='New custom tool'
                    description='Build a tool your agents can call'
                  >
                    {createTool}
                  </SettingsRow>
                )}
              </SettingsList>
            </>
          )
        }
      </SettingsRead>
    </SectionStack>
  )
}
