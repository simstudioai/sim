'use client'

import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  BlockToolRow,
  PermissionBulkSelect,
  type PermissionControls,
  StatusFilter,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/permission-rows'
import {
  type AccessRequestTarget,
  type EditorBlock,
  type EditorModel,
  matchesStatusFilter,
  type PermissionStatusFilter,
} from '@/platform/lib/data/access-control'
import { compareText } from '@/platform/shared/time'

interface BlocksTabProps {
  model: EditorModel
  controls: PermissionControls
  search: string
  query: string
  status: PermissionStatusFilter
  onSearchChange: (search: string) => void
  onStatusChange: (status: PermissionStatusFilter) => void
}

function targets(blocks: EditorBlock[]): AccessRequestTarget[] {
  return blocks.map((block) => ({ kind: 'integration', id: block.type }))
}

/** Core blocks, then integrations and triggers with their tools. */
export function BlocksTab({
  model,
  controls,
  search,
  query,
  status,
  onSearchChange,
  onStatusChange,
}: BlocksTabProps) {
  const filtered = model.visibleBlocks
    .filter((block) => !query || block.name.toLowerCase().includes(query))
    .filter((block) =>
      matchesStatusFilter(status, controls.getState({ kind: 'integration', id: block.type }))
    )
  const core = filtered.filter((block) => block.category === 'blocks')
  const tools = filtered
    .filter((block) => block.category === 'tools' || block.category === 'triggers')
    .sort((a, b) => compareText(a.name, b.name))
  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search blocks'
            placeholder='Search blocks…'
            value={search}
            onValueChange={onSearchChange}
          />
        }
      >
        <StatusFilter value={status} onChange={onStatusChange} />
      </SectionToolbar>
      {core.length === 0 && tools.length === 0 && (
        <SettingsList title='Blocks' empty={{ title: 'No matching blocks' }} />
      )}
      {core.length > 0 && (
        <SettingsSection title='Core blocks'>
          <SettingsRow
            label='All core blocks'
            description='Set access for every core block at once'
          >
            <PermissionBulkSelect targets={targets(core)} controls={controls} />
          </SettingsRow>
          {core.map((block) => (
            <BlockToolRow key={block.type} block={block} controls={controls} />
          ))}
        </SettingsSection>
      )}
      {tools.length > 0 && (
        <SettingsSection title='Integrations and triggers'>
          <SettingsRow
            label='All integrations and triggers'
            description='Choose access for an integration, then expand it to set individual tools'
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
