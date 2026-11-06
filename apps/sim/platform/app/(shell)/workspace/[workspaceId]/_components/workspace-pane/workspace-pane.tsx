import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-pane/workspace-pane.module.css'
import { type Appearance, publicAssetPath } from '@/platform/design-system/navigation'
import type { Scenario } from '@/platform/fixtures'

interface WorkspacePaneProps {
  section: string
  title: string
  workflowId?: string
  scenario: Scenario
  theme: Appearance
}

/** A separate document keeps the existing workspace renderer and its stylesheet out of the shell. */
export function WorkspacePane({ section, title, workflowId, scenario, theme }: WorkspacePaneProps) {
  const query = new URLSearchParams({ section, state: scenario, theme })
  if (workflowId) query.set('workflow', workflowId)
  return (
    <iframe
      className={styles.pane}
      title={title}
      src={`${publicAssetPath('/preview-workspace/index.html')}?${query}`}
    />
  )
}
