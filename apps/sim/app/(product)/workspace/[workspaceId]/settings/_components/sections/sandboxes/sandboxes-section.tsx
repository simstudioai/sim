'use client'

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
  contentsSummary,
  SandboxEditor,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/sandboxes/sandbox-editor'
import { UpgradeNotice } from '@/app/(product)/workspace/[workspaceId]/settings/_components/upgrade-notice/upgrade-notice'
import {
  SANDBOX_UPGRADE_DESCRIPTION,
  SANDBOX_UPGRADE_TITLE,
  useSandboxes,
  useSettingsSearch,
} from '@/platform/lib/data/sandboxes'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

const LANGUAGE_LABEL = { python: 'Python', javascript: 'JavaScript' } as const

/** The workspace's Function-block sandboxes: package lists, managed CLI tools and their builds. */
export default function SandboxesSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const {
    canMutate: canAdmin,
    locked,
    permission,
  } = useWorkspaceSettingsSection(workspaceId, 'sandboxes')
  const [search, setSearch] = useSettingsSearch()
  const subview = useSettingsSubview({ idParam: 'sandboxId', createParam: 'create-sandbox' })
  const sandboxesQuery = useSandboxes(workspaceId)
  const { data, isPending } = sandboxesQuery

  if (isPending) return subview.id === null && !subview.creating ? <SettingsPageHeader /> : null

  if (data && (locked || !data.entitled))
    return (
      <SectionStack>
        <SettingsPageHeader />
        <UpgradeNotice
          title={SANDBOX_UPGRADE_TITLE}
          description={SANDBOX_UPGRADE_DESCRIPTION}
          canUpgrade={permission === 'admin'}
        />
      </SectionStack>
    )

  const sandboxes = data?.sandboxes ?? []
  const selected = subview.id ? sandboxes.find((sandbox) => sandbox.id === subview.id) : undefined
  if (data && ((subview.creating && canAdmin) || selected))
    return (
      <SandboxEditor
        key={selected?.id ?? 'new'}
        workspaceId={workspaceId}
        sandbox={selected ?? null}
        strategy={data.strategy}
        canAdmin={canAdmin}
        onClose={subview.close}
      />
    )

  const query = search.trim().toLowerCase()
  const filtered = query
    ? sandboxes.filter(
        (sandbox) =>
          sandbox.name.toLowerCase().includes(query) ||
          sandbox.dependencies.some((dependency) => dependency.toLowerCase().includes(query)) ||
          sandbox.systemPackages.some((systemPackage) =>
            systemPackage.toLowerCase().includes(query)
          ) ||
          sandbox.cliTools.some((cliTool) => cliTool.toLowerCase().includes(query))
      )
    : sandboxes
  const createSandbox = canAdmin ? (
    <Button size='compact' icon='I074' onClick={subview.create}>
      Create sandbox
    </Button>
  ) : undefined

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SettingsRead query={sandboxesQuery} failureMessage='Couldn’t load sandboxes'>
        {() => (
          <>
            {sandboxes.length > 0 && (
              <SectionToolbar
                grow={
                  <SearchField
                    label='Search sandboxes'
                    placeholder='Search sandboxes…'
                    value={search}
                    onValueChange={setSearch}
                  />
                }
              />
            )}
            <SettingsList
              title='Sandboxes'
              empty={
                filtered.length > 0
                  ? undefined
                  : query
                    ? { title: 'No matching sandboxes' }
                    : {
                        title: 'No sandboxes yet',
                        description:
                          'Add packages and managed CLI tools your Function blocks can use',
                        action: createSandbox,
                      }
              }
            >
              <ResourceList>
                {filtered.map((sandbox) => (
                  <ActivityRow
                    key={sandbox.id}
                    leading={<Icon name='I107' />}
                    title={sandbox.name}
                    detail={`${LANGUAGE_LABEL[sandbox.language]} · ${contentsSummary(sandbox)}`}
                    onOpen={() => subview.open(sandbox.id)}
                  />
                ))}
              </ResourceList>
              {createSandbox && (
                <SettingsRow
                  label='New sandbox'
                  description='Choose the packages and tools your Function blocks can use'
                >
                  {createSandbox}
                </SettingsRow>
              )}
            </SettingsList>
          </>
        )}
      </SettingsRead>
    </SectionStack>
  )
}
