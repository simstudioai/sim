import { TabStripAction, Tooltip } from '@sim/emcn'
import { Columns3, Eye, Pencil } from '@sim/emcn/icons'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { RESOURCE_TAB_ICON_CLASS } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

/** Each icon shows the mode a click switches to. */
const PREVIEW_MODE_ICONS = {
  editor: Columns3,
  split: Eye,
  preview: Pencil,
} as const

const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  editor: 'Split Mode',
  split: 'Preview Mode',
  preview: 'Edit Mode',
}

interface PreviewModeToggleProps {
  mode: PreviewMode
  onCycle: () => void
}

export function PreviewModeToggle({ mode, onCycle }: PreviewModeToggleProps) {
  const Icon = PREVIEW_MODE_ICONS[mode]
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <TabStripAction variant='subtle' onClick={onCycle} aria-label='Cycle preview mode'>
          <Icon className={RESOURCE_TAB_ICON_CLASS} />
        </TabStripAction>
      </Tooltip.Trigger>
      <Tooltip.Content side='bottom'>
        <p>{PREVIEW_MODE_LABELS[mode]}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
