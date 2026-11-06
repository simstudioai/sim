'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import type { UsageBreakdownDimension } from '@/lib/api/contracts/organization-usage'
import {
  Button,
  DateRangePicker,
  RangePicker,
  ScrollArea,
  SegmentedControl,
} from '@/platform/design-system/components'
import {
  type CreditsTarget,
  ManageCreditsModal,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/manage-credits-modal'
import {
  DetailHeader,
  HeadingRow,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import {
  ActivityOverview,
  ActivityPanel,
} from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/activity'
import { UsageConsumers } from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-consumers'
import { UsageCredits } from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-credits'
import { UsageCalendar } from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-heatmap'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import {
  exportUsageCsv,
  OVERVIEW_TAB,
  SECTION_LABELS,
  topRows,
  USAGE_TABS,
  useUsageBreakdown,
  useUsageOverview,
  useUsageView,
} from '@/platform/embedded/lib/data/usage'

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
        <UsageCredits label={`Credits · ${periodLabel}`} overview={workspaceOverview} />
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
      <HeadingRow>
        <ScrollArea label='Insights views' axis='horizontal'>
          <SegmentedControl
            label='Insights views'
            options={USAGE_TABS}
            value={tab}
            onSelect={view.selectTab}
          />
        </ScrollArea>
        <div className={styles.actions}>
          <RangePicker
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
        </div>
      </HeadingRow>
      {isOverview ? (
        <>
          <UsageCredits label='Credits' overview={overview} />
          <UsageCalendar organizationId={organizationId} timezone={window.timezone} />
          <div className={styles.cards}>
            <UsageConsumers
              title='Top models'
              dimension='model'
              list={{ ...models, data: topRows(models.data) }}
              control={
                <span className={styles.edgeAction}>
                  <Button variant='quiet' size='compact' onClick={() => view.selectTab('model')}>
                    View all
                  </Button>
                </span>
              }
            />
            <UsageConsumers
              title='Top members'
              dimension='member'
              list={{ ...overview, data: overview.data?.members }}
              control={
                <span className={styles.edgeAction}>
                  <Button variant='quiet' size='compact' onClick={() => view.selectTab('member')}>
                    View all
                  </Button>
                </span>
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
