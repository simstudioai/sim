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
import { isAuditLogsEnabled, isHosted } from '@/lib/core/config/env-flags'
import {
  ManageCreditsModal,
  type ManageCreditsTarget,
} from '@/app/workspace/[workspaceId]/settings/components/manage-credits-modal'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { serializeAuditLogFilters } from '@/ee/audit-logs/search-params'
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

/**
 * One labelled band per view. The unit lives here rather than on every row — ten rows
 * each ending in the word "credits" is noise, and a column header is where a reader
 * already looks for it.
 */
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

/**
 * Organization usage monitoring.
 *
 * The panel reads as one question per tab: how much and what kind of work
 * (Overview), then who (Members), where (Workspaces), and on what (Models, BYOK).
 * Only the visible tab's dimension is fetched, which is also the performance story —
 * half the dimensions heap-scan the ledger, and a tab nobody opens never pays for one.
 */
export function UsageMonitoring({
  organizationId,
  eventsHref: eventsBaseHref,
  auditLogsHref: auditLogsBaseHref,
}: UsageMonitoringProps) {
  const router = useRouter()
  const { window, tab, workspace, expanded, preset, startDate, endDate, periodLabel, setState } =
    useUsageWindow()
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  /** The member whose credit limit is being edited, or null when the modal is closed. */
  const [creditsTarget, setCreditsTarget] = useState<ManageCreditsTarget | null>(null)

  const isOverview = tab === USAGE_OVERVIEW_TAB
  /**
   * A selected workspace turns the Workspaces tab into that workspace's workflows —
   * but only once the id resolves against the loaded list. A bookmarked id for a
   * deleted workspace, or one belonging to another organization, would otherwise open
   * a detail view with an untitled header and empty sections. Falling back to the
   * list is the rule for every deep-linked entity id (`sim-url-state.md`); the
   * lingering param is harmless.
   */
  const isWorkspaceSelected = tab === 'workspace' && Boolean(workspace)

  /**
   * Per-member caps are hosted-only: the usage-limit route 404s where Sim does not
   * own billing, and there is no enforcement to hang a cap off. This panel is the
   * one organization surface a self-hosted enterprise can reach — Members is
   * `requiresHosted` with no self-hosted override — so without this the menu would
   * offer an action that could only fail.
   */
  const canManageCredits = tab === 'member' && isHosted

  const summary = useOrganizationUsageSummary(organizationId, window)
  /**
   * Kept alive in the drill-down purely to name it. The rule is to store the id and
   * derive the entity from the loaded list.
   *
   * Pinned to the full page rather than to the panel's current row limit: the id can
   * come from an expanded list or from a bookmark, and a lookup that only held the
   * top ten resolved nothing for either — which reads as the drill-down refusing to
   * open, since `isWorkspaceDetail` gates on the name. Requesting the ceiling means a
   * click from an expanded list is served from that list's own cache entry.
   */
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

  const dimension: UsageBreakdownDimension = isOverview
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

  /**
   * Opens one list's tail, unless it is already at the API's ceiling — past that the
   * `Other` row is a true remainder and the control would do nothing. `undefined`
   * rather than a no-op handler, so the row renders as text instead of as a button.
   */
  const expandOtherFor = (target: UsageBreakdownDimension) =>
    rowLimitFor(target) < EXPANDED_ROW_COUNT
      ? () => void setState({ expanded: [...expanded, target] })
      : undefined

  const breakdown = useOrganizationUsageBreakdown(organizationId, window, dimension, {
    limit: rowLimitFor(dimension),
    ...(isWorkspaceDetail && workspace ? { workspaceId: workspace } : {}),
  })
  const workspaceSources = useOrganizationUsageBreakdown(organizationId, window, 'source', {
    enabled: isWorkspaceDetail,
    limit: rowLimitFor('source'),
    ...(workspace ? { workspaceId: workspace } : {}),
  })
  /**
   * The same headline and trend the Overview draws, narrowed to this workspace.
   *
   * A second summary rather than a figure derived from the lists below it: they carry
   * totals but no time series, and the shape of the period is the question the chart
   * answers. It is also the only place the drill-down states its window, which is why
   * its section is labelled with the period rather than with the word "Usage".
   */
  const workspaceSummary = useOrganizationUsageSummary(organizationId, window, {
    enabled: isWorkspaceDetail,
    ...(workspace ? { workspaceId: workspace } : {}),
  })
  // Already cached by Members and Billing, so the meter costs nothing extra and
  // cannot report a different allowance than they do.
  const billing = useOrganizationBilling(organizationId)

  /**
   * The organization audit feed, narrowed to the workspace being drilled into.
   *
   * Only offered where that section exists. Usage and Audit logs carry the same
   * hosted and enterprise gates, so reaching this panel already proves both — but
   * their self-hosted overrides are separate flags, and an install with usage
   * monitoring on and audit logs off would have been handed an action pointing at a
   * section it had switched off. The window is deliberately not carried across: the
   * audit feed speaks in rolling ranges (`Past 30 days`) and this panel in billing
   * periods, so there is no honest mapping for `current-period`.
   */
  const auditLogsHref =
    isHosted || isAuditLogsEnabled
      ? serializeAuditLogFilters(auditLogsBaseHref, { workspace })
      : null

  /**
   * The drill-down is the same window, in more detail. Without the params it read its
   * own defaults and silently showed the current period while the panel behind it
   * showed a custom range — two pages disagreeing about what "this" means.
   */
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
    void setState({ preset: value as typeof preset, startDate: null, endDate: null })
  }

  const handleDateRangeApply = (nextStart: string, nextEnd: string) => {
    /**
     * Refuse an over-long range here rather than committing it and letting all four
     * reads fail. The server still enforces the cap — this is the same rule stated
     * where the user can act on it, with the picker left open on the selection that
     * needs changing.
     */
    const spanDays = Math.ceil(
      (new Date(nextEnd).getTime() - new Date(nextStart).getTime()) / DAY_MS
    )
    if (spanDays + 1 > MAX_CUSTOM_RANGE_DAYS) {
      toast.error(`Select a range of ${MAX_CUSTOM_RANGE_DAYS} days or fewer`)
      return
    }
    void setState({ preset: 'custom', startDate: nextStart, endDate: nextEnd })
    setDatePickerOpen(false)
  }

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    // The organization is the path segment below; the query no longer carries a
    // second copy of it.
    const params = new URLSearchParams({
      preset: window.preset,
      timezone: window.timezone,
    })
    if (window.startDate) params.set('startDate', window.startDate)
    if (window.endDate) params.set('endDate', window.endDate)

    /**
     * Wrapped because the action is fire-and-forget: `onSelect` cannot await this, so
     * a rejection — a dropped connection, a blob read that fails — became an unhandled
     * promise and the button appeared to do nothing at all.
     */
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

  /**
   * The drill-down is a detail view, so it takes over the header: a back chip out of
   * it, and the one action that belongs to a workspace rather than the organization.
   */
  if (isWorkspaceDetail && workspace) {
    return (
      <SettingsPanel
        // Opening pushes (the drill-down is a destination, not a filter), so closing
        // replaces — the rule for a selected entity in `sim-url-state.md`.
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
                  /*
                    The organization's audit feed, scoped to this workspace — not
                    `/workspace/<id>/logs`. Organization admin is not workspace
                    membership, and `WorkspaceLayout` answers a non-member with
                    `WorkspaceAccessDenied`, so the run-logs route was a one-way trip
                    to a dead end for any workspace the admin had not joined. Audit
                    logs live in the settings section the admin is already inside.
                  */
                  text: 'Open logs',
                  onSelect: () => router.push(auditLogsHref),
                  onPrefetch: () => router.prefetch(auditLogsHref),
                },
              ]
            : []
        }
      >
        {/*
          Labelled with the period, not "Usage": the picker lives on the list behind
          this view, so once you are in here the window is carried but invisible — and
          a total with no stated period is a number people read as all-time. The
          heading the chart already needs is where that belongs.

          No allowance passed, unlike the Overview: the limit is pooled across the
          whole organization, and printing it under one workspace's figure would read
          as that workspace's own cap.
        */}
        <SettingsSection label={periodLabel}>
          <UsageSummary
            summary={workspaceSummary.data}
            isLoading={workspaceSummary.isLoading}
            isError={workspaceSummary.isError}
            isPlaceholderData={workspaceSummary.isPlaceholderData}
          />
        </SettingsSection>
        {/*
          Sources first, because in most workspaces the majority of usage is Chat
          rather than workflow runs — and a workflow list alone hid that behind a
          single unexplained row. Sources reconciles to the workspace total; Workflows
          is explicitly the workflow-run subset of it.
        */}
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
      </SettingsPanel>
    )
  }

  return (
    <>
      <SettingsPanel
        actions={[
          {
            text: 'All events',
            onSelect: () => router.push(eventsHref),
            onPrefetch: () => router.prefetch(eventsHref),
          },
          {
            text: 'Export',
            icon: Download,
            onSelect: () => void handleExport(),
            disabled: summary.isLoading || isExporting,
          },
        ]}
      >
        <div className='flex items-center justify-between gap-2'>
          <ChipModalTabs
            tabs={TABS}
            value={tab}
            /*
            `expanded` describes one list, so it is cleared with the list. Carrying it
            across meant landing on a different tab already opened to fifty rows.
          */
            onChange={(value) =>
              void setState({ tab: value as UsageTab, workspace: null, expanded: null })
            }
          />
          <div className='relative shrink-0'>
            {/* ChipCombobox (Radix Popover, non-modal), not ChipSelect (Radix
              DropdownMenu, modal by default) — a modal trigger closing in the
              same tick that opens the Calendar popover below traps it behind
              the modal's focus lock, so "Custom range" silently does nothing. */}
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
                {/*
                No `showTime`: the panel buckets by calendar day, so a time of day is
                precision it cannot render. It also emitted the end bound as an
                inclusive `…T23:59:59` local wall time, which the window resolver then
                treated as a midnight and pushed a further 24h — every custom range
                covered an extra day, and a legal 92-day pick measured 93 and was
                rejected. Bare `YYYY-MM-DD` bounds parse as UTC midnight, matching the
                rest of the window logic.
              */}
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
            {/*
            The allowance is a per-billing-period figure, so it is only comparable
            to the current period's total. Against a rolling window or a custom
            range it measures a different span than the limit covers — a 30-day
            window spanning two periods could read "Over limit" while neither
            period was — so those windows show the figure without an allowance.
          */}
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
            {/*
            "What kind of work was this?" belongs beside the total it explains, not
            behind a tab — it is the second half of the same sentence.

            One section, two readings of it: the list ranks the sources, the web shows
            whether spend is concentrated or spread. Two `SettingsSection`s side by
            side would have drawn two half-width hairlines on one line — every other
            rule in this panel spans the column — and left one header carrying the
            `credits` unit while its neighbour, showing the same data, carried none.

            `auto-fit` on a track minimum rather than a `lg:` breakpoint: the settings
            content column is a fixed `max-w-[48rem]`, so viewport width says nothing
            about how wide this actually is. Same rule as `RESOURCE_LIST_GRID`.
          */}
            <UsageSection dimension='source' unit='credits'>
              {/*
                `min(320px, 100%)` rather than a bare `320px`: a track minimum is a
                hard floor, so on a column narrower than the minimum the grid would
                be wider than its container and overflow. Capping the floor at the
                available width collapses it to one column instead.
              */}
              <div className='grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-x-6 gap-y-7'>
                <UsageConsumers
                  dimension='source'
                  breakdown={breakdown.data}
                  isLoading={breakdown.isLoading}
                  isError={breakdown.isError}
                  isPlaceholderData={breakdown.isPlaceholderData}
                  onExpandOther={expandOtherFor('source')}
                />
                <UsageSourceMix
                  breakdown={breakdown.data}
                  isLoading={breakdown.isLoading}
                  isError={breakdown.isError}
                />
              </div>
            </UsageSection>
          </>
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
                    /*
                      `push`, not the group's default `replace`: this opens a
                      destination with its own back chip, and replacing meant browser
                      Back skipped the Workspaces list and left settings entirely.
                    */
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
      {/*
        A sibling of the panel, not a child. `SettingsPanel` renders its children
        straight into the shell's gap-7 content column, so a modal mounted inside it
        is a body slot that contributes to that spacing.

        The same modal the Members settings page opens, driven by the same hooks —
        setting a cap here and there is one implementation, not two.
      */}
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
