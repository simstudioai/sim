'use client'

import { useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import Link from 'next/link'
import {
  ActionRow,
  DetailHeader,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import {
  type CreditsTarget,
  ManageCreditsModal,
} from '@/platform/app/(shell)/settings/_components/section-parts/manage-credits-modal'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import {
  ActivityOverview,
  ActivityPanel,
} from '@/platform/app/(shell)/settings/_components/sections/usage/activity'
import { UsageConsumers } from '@/platform/app/(shell)/settings/_components/sections/usage/usage-consumers'
import { UsageCredits } from '@/platform/app/(shell)/settings/_components/sections/usage/usage-credits'
import { UsageCalendar } from '@/platform/app/(shell)/settings/_components/sections/usage/usage-heatmap'
import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import {
  exportUsageCsv,
  type UsageBreakdownDimension,
  useUsageBreakdown,
  useUsageOverview,
  useUsageView,
} from '@/platform/lib/data/usage'
import { OVERVIEW_TAB, SECTION_LABELS, topRows, USAGE_TABS } from '@/platform/shared/usage'

export function UsageMonitoring({ organization }: Pick<SettingsSectionProps, 'organization'>) {
  const organizationId = organization.organization.id
  const { hosted, features } = organization.deployment
  const view = useUsageView()
  const { window, tab, workspace, expanded, startDate, endDate, periodLabel, setState } = view
  const periodId = useId()
  const [choosingRange, setChoosingRange] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [creditsTarget, setCreditsTarget] = useState<CreditsTarget | null>(null)

  const isOverview = tab === OVERVIEW_TAB
  const isWorkspaceSelected = tab === 'workspace' && Boolean(workspace)
  /** Member credit caps are enforced only on hosted deployments. */
  const canManageCredits = tab === 'member' && hosted
  const overview = useUsageOverview(organizationId, window, { enabled: isOverview })
  /** The full page resolves an id selected from an expanded list. */
  const workspaceList = useUsageBreakdown(organizationId, window, 'workspace', {
    enabled: isWorkspaceSelected,
    expanded: true,
  })
  const workspaceName = workspaceList.data?.rows.find((row) => row.id === workspace)?.label
  /** A dead id falls back to the Workspaces tab, once the list can actually say it is dead. */
  const isWorkspaceDetail =
    isWorkspaceSelected &&
    (workspaceList.loading || workspaceList.failed || workspaceName !== undefined)
  const dimension: UsageBreakdownDimension = isWorkspaceDetail
    ? 'workflow'
    : isOverview || tab === 'activity'
      ? 'member'
      : (tab as UsageBreakdownDimension)
  const isExpanded = (target: UsageBreakdownDimension) => expanded.includes(target)
  const expandOther = (target: UsageBreakdownDimension) =>
    isExpanded(target) ? undefined : () => void setState({ expanded: [...expanded, target] })
  const breakdown = useUsageBreakdown(organizationId, window, dimension, {
    enabled: !isOverview && tab !== 'activity',
    expanded: isExpanded(dimension),
    workspaceId: isWorkspaceDetail && workspace ? workspace : undefined,
  })
  const workspaceOverview = useUsageOverview(organizationId, window, {
    enabled: isWorkspaceDetail,
    workspaceId: workspace ?? undefined,
  })
  const models = useUsageBreakdown(organizationId, window, 'model', { enabled: isOverview })

  if (isWorkspaceDetail && workspace) {
    return (
      <>
        <DetailHeader
          backLabel='Workspaces'
          title={workspaceName ?? 'Workspace usage'}
          onBack={() => void setState({ workspace: null, expanded: null })}
        >
          {(hosted || features.auditLogs) && (
            <Button render={<Link href={view.auditLogsHref(workspace)} />}>Open logs</Button>
          )}
        </DetailHeader>
        <UsageCredits label={periodLabel} overview={workspaceOverview} />
        <UsageCalendar
          organizationId={organizationId}
          timezone={window.timezone}
          workspaceId={workspace}
        />
        <UsageConsumers
          title={SECTION_LABELS.workflow}
          dimension='workflow'
          list={breakdown}
          onExpandOther={expandOther('workflow')}
        />
        <ActivityOverview organizationId={organizationId} window={window} workspaceId={workspace} />
      </>
    )
  }

  return (
    <>
      <div className={styles.toolbar}>
        <ScrollArea label='Insights views' axis='horizontal'>
          <SegmentedControl
            label='Insights views'
            options={USAGE_TABS}
            value={tab}
            onSelect={view.selectTab}
          />
        </ScrollArea>
        <div className={styles.actions}>
          <ChoiceMenu
            id={periodId}
            label='Period'
            options={view.periodOptions}
            value={choosingRange ? 'Custom range' : view.currentPeriod}
            onValueChange={(label) => setChoosingRange(view.selectPeriod(label))}
          />
          {(choosingRange || view.preset === 'custom') && (
            <DateRangePicker
              label='Custom range'
              labelHidden
              open={choosingRange}
              onOpenChange={(open) => {
                setChoosingRange(open)
                if (!open && view.preset !== 'custom') document.getElementById(periodId)?.focus()
              }}
              value={startDate && endDate ? { start: startDate, end: endDate } : null}
              onValueChange={(range) => range !== null && view.applyRange(range.start, range.end)}
            />
          )}
        </div>
      </div>
      {isOverview ? (
        <>
          <UsageCredits label={periodLabel} overview={overview} />
          <UsageCalendar organizationId={organizationId} timezone={window.timezone} />
          <div className={styles.cards}>
            <UsageConsumers
              title='Top models'
              dimension='model'
              list={{ ...models, data: topRows(models.data) }}
              control={
                <Button variant='quiet' size='compact' onClick={() => view.selectTab('model')}>
                  View all
                </Button>
              }
            />
            <UsageConsumers
              title='Top members'
              dimension='member'
              list={{ ...overview, data: overview.data?.members }}
              control={
                <Button variant='quiet' size='compact' onClick={() => view.selectTab('member')}>
                  View all
                </Button>
              }
            />
          </div>
          <ActivityOverview organizationId={organizationId} window={window} />
        </>
      ) : tab === 'activity' ? (
        <ActivityPanel organizationId={organizationId} />
      ) : (
        <UsageConsumers
          title={SECTION_LABELS[dimension]}
          dimension={dimension}
          list={breakdown}
          onExpandOther={expandOther(dimension)}
          onSelectRow={
            tab === 'workspace'
              ? (row) => void setState({ workspace: row.id, expanded: null }, { history: 'push' })
              : undefined
          }
          onManageCredits={
            canManageCredits
              ? (row) => row.id && setCreditsTarget({ userId: row.id, name: row.label })
              : undefined
          }
        />
      )}
      <ActionRow>
        <Button render={<Link href={view.eventsHref} />} variant='quiet'>
          All events
        </Button>
        <Button
          disabled={exporting}
          onClick={async () => {
            setExporting(true)
            await exportUsageCsv(organizationId, window)
            setExporting(false)
          }}
        >
          Export
        </Button>
      </ActionRow>
      {canManageCredits && creditsTarget && (
        <ManageCreditsModal
          key={creditsTarget.userId}
          member={creditsTarget}
          onClose={() => setCreditsTarget(null)}
        />
      )}
    </>
  )
}
