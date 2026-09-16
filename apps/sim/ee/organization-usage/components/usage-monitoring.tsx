'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  Calendar,
  ChipCombobox,
  ChipModalTabs,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@sim/emcn'
import { ArrowLeft, Download } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import {
  MAX_CUSTOM_RANGE_DAYS,
  type UsageBreakdownDimension,
} from '@/lib/api/contracts/organization-usage'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  ManageCreditsModal,
  type ManageCreditsTarget,
} from '@/app/workspace/[workspaceId]/settings/components/manage-credits-modal'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { serializeAuditLogFilters } from '@/ee/audit-logs/search-params'
import { ActivityPanel } from '@/ee/organization-usage/components/activity-panel'
import { OrganizationActivityOverview } from '@/ee/organization-usage/components/activity-summary'
import { UsageConsumers } from '@/ee/organization-usage/components/usage-consumers'
import { UsageSourceMix } from '@/ee/organization-usage/components/usage-source-mix'
import { UsageSummary } from '@/ee/organization-usage/components/usage-summary'
import {
  COLLAPSED_ROW_COUNT,
  EXPANDED_ROW_COUNT,
  PERIOD_OPTIONS,
  USAGE_OVERVIEW_TAB,
  USAGE_SECTION_LABELS,
  USAGE_TAB_LABELS,
  USAGE_TAB_ORDER,
  type UsageTab,
} from '@/ee/organization-usage/constants'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import { serializeOrganizationUsageParams } from '@/ee/organization-usage/search-params'
import { useOrganizationBilling } from '@/hooks/queries/organization'
import {
  useOrganizationUsageBreakdown,
  useOrganizationUsageSummary,
} from '@/hooks/queries/organization-usage'

const TABS = USAGE_TAB_ORDER.map((tab) => ({ value: tab, label: USAGE_TAB_LABELS[tab] }))

const DAY_MS = 24 * 60 * 60 * 1000

function UsageSection({
  dimension,
  unit,
  children,
}: {
  dimension: UsageBreakdownDimension
  unit: 'credits' | 'tokens'
  children: ReactNode
}) {
  return (
    <SettingsSection
      label={USAGE_SECTION_LABELS[dimension]}
      action={<span className='text-[var(--text-muted)] text-small'>{unit}</span>}
    >
      {children}
    </SettingsSection>
  )
}

interface UsageMonitoringProps {
  organizationId: string
  /**
   * Base path of the events drill-down, built by the settings switch the same way it
   * builds `creditUsageHref` and `billingHref`. The panel appends its own window.
   */
  eventsHref: string
  /** Base path of the audit-logs section, which the workspace drill-down scopes. */
  auditLogsHref: string
}

export function UsageMonitoring({
  organizationId,
  eventsHref: eventsBaseHref,
  auditLogsHref: auditLogsBaseHref,
}: UsageMonitoringProps) {
  const router = useRouter()
  const { hosted, features } = useDeploymentShape()
  const { window, tab, workspace, expanded, preset, startDate, endDate, periodLabel, setState } =
    useUsageWindow()
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [creditsTarget, setCreditsTarget] = useState<ManageCreditsTarget | null>(null)

  const isOverview = tab === USAGE_OVERVIEW_TAB
  /** Resolve bookmarked workspace IDs before opening the credit drill-down. */
  const isWorkspaceSelected = tab === 'workspace' && Boolean(workspace)

  /** Member credit caps are enforced only on hosted deployments. */
  const canManageCredits = tab === 'member' && hosted

  const summary = useOrganizationUsageSummary(organizationId, window, { enabled: isOverview })
  /** Use the full workspace page to resolve IDs selected from an expanded list. */
  const workspaceList = useOrganizationUsageBreakdown(organizationId, window, 'workspace', {
    enabled: isWorkspaceSelected,
    limit: EXPANDED_ROW_COUNT,
  })
  const workspaceName = workspaceList.data?.rows.find((row) => row.id === workspace)?.label
  /**
   * Resolved, not merely present — and only once the list has actually loaded, so a
   * deep link does not flash the Workspaces tab before its own detail view.
   */
  const isWorkspaceDetail =
    isWorkspaceSelected && (workspaceList.isLoading || workspaceName !== undefined)

  const dimension: UsageBreakdownDimension =
    isOverview || tab === 'activity'
      ? 'source'
      : isWorkspaceDetail
        ? 'workflow'
        : (tab as UsageBreakdownDimension)

  /**
   * Per breakdown, not per page: the drill-down shows two lists at once, so opening
   * one tail has to leave its neighbour at the count it was rendered with.
   */
  const rowLimitFor = (target: UsageBreakdownDimension) =>
    expanded.includes(target) ? EXPANDED_ROW_COUNT : COLLAPSED_ROW_COUNT

  /** Offer expansion only while the API can return additional rows. */
  const expandOtherFor = (target: UsageBreakdownDimension) =>
    rowLimitFor(target) < EXPANDED_ROW_COUNT
      ? () => void setState({ expanded: [...expanded, target] })
      : undefined

  const breakdown = useOrganizationUsageBreakdown(organizationId, window, dimension, {
    enabled: tab !== 'activity',
    limit: rowLimitFor(dimension),
    ...(isWorkspaceDetail && workspace ? { workspaceId: workspace } : {}),
  })
  const workspaceSources = useOrganizationUsageBreakdown(organizationId, window, 'source', {
    enabled: isWorkspaceDetail,
    limit: rowLimitFor('source'),
    ...(workspace ? { workspaceId: workspace } : {}),
  })

  const workspaceSummary = useOrganizationUsageSummary(organizationId, window, {
    enabled: isWorkspaceDetail,
    ...(workspace ? { workspaceId: workspace } : {}),
  })
  const billing = useOrganizationBilling(organizationId, {
    enabled: isOverview && preset === 'current-period',
  })

  /** Audit logs have a separate deployment flag and incompatible period presets. */
  const auditLogsHref =
    hosted || features.auditLogs ? serializeAuditLogFilters(auditLogsBaseHref, { workspace }) : null

  const eventsHref = serializeOrganizationUsageParams(eventsBaseHref, {
    preset: window.preset,
    startDate: window.startDate ?? null,
    endDate: window.endDate ?? null,
  })

  const handlePeriodChange = (value: string) => {
    if (value === 'custom') {
      setDatePickerOpen(true)
      return
    }
    void setState({
      preset: value as typeof preset,
      startDate: null,
      endDate: null,
      activityPage: 0,
    })
  }

  const handleDateRangeApply = (nextStart: string, nextEnd: string) => {
    const spanDays = Math.ceil(
      (new Date(nextEnd).getTime() - new Date(nextStart).getTime()) / DAY_MS
    )
    if (spanDays + 1 > MAX_CUSTOM_RANGE_DAYS) {
      toast.error(`Select a range of ${MAX_CUSTOM_RANGE_DAYS} days or fewer`)
      return
    }
    void setState({ preset: 'custom', startDate: nextStart, endDate: nextEnd, activityPage: 0 })
    setDatePickerOpen(false)
  }

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    const params = new URLSearchParams({
      preset: window.preset,
      timezone: window.timezone,
    })
    if (window.startDate) params.set('startDate', window.startDate)
    if (window.endDate) params.set('endDate', window.endDate)

    try {
      // boundary-raw-fetch: downloads a CSV blob and reads X-Export-Truncated before saving — a plain anchor navigation can do neither
      const response = await fetch(
        `/api/organizations/${organizationId}/usage/export?${params.toString()}`
      )
      if (!response.ok) {
        toast.error('Failed to export usage')
        return
      }
      if (response.headers.get('X-Export-Truncated') === '1') {
        toast.info('Export truncated — narrow the date range to see everything')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `organization-usage-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to export usage')
    } finally {
      setIsExporting(false)
    }
  }

  if (isWorkspaceDetail && workspace) {
    return (
      <SettingsPanel
        /** Replace when leaving a detail opened with push. */
        back={{
          text: 'Workspaces',
          icon: ArrowLeft,
          onSelect: () => void setState({ workspace: null, expanded: null }),
        }}
        title={workspaceName ?? 'Workspace usage'}
        actions={
          auditLogsHref
            ? [
                {
                  /** Organization admins may lack workspace membership, so link to organization audit logs. */
                  text: 'Open logs',
                  onSelect: () => router.push(auditLogsHref),
                  onPrefetch: () => router.prefetch(auditLogsHref),
                },
              ]
            : []
        }
      >
        {/** Organization allowances do not apply to a single workspace. */}
        <SettingsSection label={periodLabel}>
          <UsageSummary
            summary={workspaceSummary.data}
            isLoading={workspaceSummary.isLoading}
            isError={workspaceSummary.isError}
            isPlaceholderData={workspaceSummary.isPlaceholderData}
          />
        </SettingsSection>
        <UsageSection dimension='source' unit='credits'>
          <UsageConsumers
            dimension='source'
            breakdown={workspaceSources.data}
            isLoading={workspaceSources.isLoading}
            isError={workspaceSources.isError}
            isPlaceholderData={workspaceSources.isPlaceholderData}
            onExpandOther={expandOtherFor('source')}
          />
        </UsageSection>
        <UsageSection dimension='workflow' unit='credits'>
          <UsageConsumers
            dimension='workflow'
            breakdown={breakdown.data}
            isLoading={breakdown.isLoading}
            isError={breakdown.isError}
            isPlaceholderData={breakdown.isPlaceholderData}
            onExpandOther={expandOtherFor('workflow')}
          />
        </UsageSection>
        <OrganizationActivityOverview
          organizationId={organizationId}
          window={window}
          workspaceId={workspace}
        />
      </SettingsPanel>
    )
  }

  return (
    <>
      <SettingsPanel
        actions={[
          {
            text: 'Credit events',
            onSelect: () => router.push(eventsHref),
            onPrefetch: () => router.prefetch(eventsHref),
          },
          {
            text: 'Export credits',
            icon: Download,
            onSelect: () => void handleExport(),
            disabled: isExporting,
          },
        ]}
      >
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='max-w-full overflow-x-auto'>
            <ChipModalTabs
              aria-label='Insights views'
              tabs={TABS}
              value={tab}
              onChange={(value) =>
                void setState({
                  tab: value as UsageTab,
                  workspace: null,
                  expanded: null,
                  activityPage: 0,
                })
              }
            />
          </div>
          <div className='relative shrink-0'>
            {/** A non-modal picker lets the calendar open without a competing focus lock. */}
            <ChipCombobox
              options={PERIOD_OPTIONS}
              value={preset}
              onChange={handlePeriodChange}
              overlayLabel={periodLabel}
              overlayContent={periodLabel}
              align='end'
            />
            <Popover
              open={datePickerOpen}
              onOpenChange={(isOpen) => {
                if (!isOpen) setDatePickerOpen(false)
              }}
            >
              <PopoverAnchor className='pointer-events-none absolute inset-0' />
              <PopoverContent align='end' sideOffset={4} className='w-auto p-0'>
                {/** Calendar-day bounds stay date-only; the server makes the end exclusive. */}
                <Calendar
                  mode='range'
                  startDate={startDate ?? undefined}
                  endDate={endDate ?? undefined}
                  onRangeChange={handleDateRangeApply}
                  onCancel={() => setDatePickerOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {isOverview ? (
          <>
            {/** Compare the allowance only with its billing period. */}
            <SettingsSection label={periodLabel}>
              <UsageSummary
                summary={summary.data}
                limitCredits={
                  preset === 'current-period' && billing.data?.data?.totalUsageLimit != null
                    ? dollarsToCredits(billing.data.data.totalUsageLimit)
                    : null
                }
                isLoading={summary.isLoading}
                isError={summary.isError}
                isPlaceholderData={summary.isPlaceholderData}
              />
            </SettingsSection>
            <OrganizationActivityOverview organizationId={organizationId} window={window} />
            <UsageSection dimension='source' unit='credits'>
              <UsageSourceMix
                breakdown={breakdown.data}
                isLoading={breakdown.isLoading}
                isError={breakdown.isError}
              />
            </UsageSection>
          </>
        ) : tab === 'activity' ? (
          <ActivityPanel organizationId={organizationId} />
        ) : (
          <UsageSection dimension={dimension} unit={dimension === 'byok' ? 'tokens' : 'credits'}>
            <UsageConsumers
              dimension={dimension}
              breakdown={breakdown.data}
              isLoading={breakdown.isLoading}
              isError={breakdown.isError}
              isPlaceholderData={breakdown.isPlaceholderData}
              onExpandOther={expandOtherFor(dimension)}
              {...(tab === 'workspace'
                ? {
                    /** Push detail navigation so Back returns to this list. */
                    onSelectRow: (row) =>
                      void setState({ workspace: row.id, expanded: null }, { history: 'push' }),
                  }
                : {})}
              {...(canManageCredits
                ? {
                    rowActions: (row) => [
                      {
                        label: 'Manage credits',
                        onSelect: () => setCreditsTarget({ userId: row.id, name: row.label }),
                      },
                    ],
                  }
                : {})}
            />
          </UsageSection>
        )}
      </SettingsPanel>
      {/** Keep the modal outside the panel’s content-spacing layout. */}
      {canManageCredits && (
        <ManageCreditsModal
          key={creditsTarget?.userId ?? 'none'}
          open={creditsTarget !== null}
          onOpenChange={(open) => {
            if (!open) setCreditsTarget(null)
          }}
          organizationId={organizationId}
          member={creditsTarget}
        />
      )}
    </>
  )
}
