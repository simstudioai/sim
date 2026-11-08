'use client'

import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { parseAsString, useQueryState } from 'nuqs'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import { RefreshStatus } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/refresh-status/refresh-status'
import {
  useNewChatHref,
  WorkspaceEmpty,
  WorkspacePage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type {
  DashboardData,
  WorkspaceRead,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { DashboardSectionView } from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/dashboard-section/dashboard-section'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/dashboard-view/dashboard-view.module.css'

interface DashboardActions {
  /** Fetch the snapshot again, keeping the current one on screen until it arrives. */
  refresh: () => void
}

interface DashboardViewProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  data: DashboardData
  actions: DashboardActions
}

/**
 * The workspace's production snapshot. It is read-only: the period and each section's own choice
 * change what it shows, and authoring happens in chat.
 */
export function DashboardView({ data, actions, read }: DashboardViewProps) {
  const newChat = useNewChatHref(data.workspace.id)
  const fallback = data.periods.find((period) => period.value === '7d') ?? data.periods[0]
  const [requested, setPeriod] = useQueryState(
    'period',
    parseAsString
      .withDefault(fallback?.value ?? '')
      .withOptions({ shallow: true, history: 'replace' })
  )
  const period = data.periods.find((item) => item.value === requested) ?? fallback
  const rows = (period && data.snapshots[period.value]) ?? []
  const empty = !Object.keys(data.snapshots).length
  return (
    <WorkspacePage
      read={read}
      workspace={data.workspace}
      current='dashboards'
      controls={
        !empty && (
          <ControlBar
            leading={
              <ChoiceMenu
                label='Period'
                options={data.periods}
                value={period?.value}
                onValueChange={(value) => void setPeriod(value === fallback?.value ? null : value)}
              />
            }
          >
            <RefreshStatus
              updatedAt={data.updatedAt}
              referenceTime={data.referenceTime}
              onRefresh={actions.refresh}
            />
          </ControlBar>
        )
      }
    >
      {empty ? (
        <WorkspaceEmpty
          title='No dashboard yet'
          description='Start a chat to create a dashboard for this workspace.'
          action={{ label: 'New chat', href: newChat }}
        />
      ) : (
        <div className={styles.rows}>
          {rows.map((row) => (
            <div key={row.id} className={styles.row} data-columns={row.sections.length}>
              {row.sections.map((section) => (
                <DashboardSectionView key={section.id} section={section} />
              ))}
            </div>
          ))}
        </div>
      )}
    </WorkspacePage>
  )
}
