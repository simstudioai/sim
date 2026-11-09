'use client'

import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { parseAsString, useQueryState } from 'nuqs'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { UpdatedStatus } from '@/app/(product)/workspace/[workspaceId]/_components/updated-status/updated-status'
import {
  useNewChatHref,
  WorkspaceEmpty,
  WorkspacePage,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type {
  DashboardData,
  WorkspaceRead,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import { DashboardSectionView } from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/dashboard-section/dashboard-section'
import styles from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/dashboard-view/dashboard-view.module.css'

interface DashboardViewProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  /** The latest snapshot; the page refreshes itself, so `updatedAt` moves on its own. */
  data: DashboardData
}

/**
 * The workspace's production snapshot. It is read-only: the period and each section's own choice
 * change what it shows, and authoring happens in chat.
 */
export function DashboardView({ data, read }: DashboardViewProps) {
  const newChat = useNewChatHref()
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
            <UpdatedStatus updatedAt={data.updatedAt} referenceTime={data.referenceTime} />
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
