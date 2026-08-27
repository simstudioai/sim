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
import type { UsageBreakdownDimension } from '@/lib/api/contracts/organization-usage'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  ManageCreditsModal,
  type ManageCreditsTarget,
} from '@/app/workspace/[workspaceId]/settings/components/manage-credits-modal'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { UsageConsumers } from '@/ee/organization-usage/components/usage-consumers'
import { UsageSummary } from '@/ee/organization-usage/components/usage-summary'
import {
  PERIOD_OPTIONS,
  USAGE_OVERVIEW_TAB,
  USAGE_SECTION_LABELS,
  USAGE_TAB_LABELS,
  USAGE_TAB_ORDER,
  type UsageTab,
} from '@/ee/organization-usage/constants'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import { useOrganizationBilling } from '@/hooks/queries/organization'
import {
  useOrganizationUsageBreakdown,
  useOrganizationUsageSummary,
} from '@/hooks/queries/organization-usage'

const TABS = USAGE_TAB_ORDER.map((tab) => ({ value: tab, label: USAGE_TAB_LABELS[tab] }))

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
      action={<span className='text-[var(--text-muted)] text-caption'>{unit}</span>}
    >
      {children}
    </SettingsSection>
  )
}

interface UsageMonitoringProps {
  organizationId: string
  /** Set by the settings section switch; the sub-route lives under this workspace. */
  workspaceId: string
}

/**
 * Organization usage monitoring.
 *
 * The panel reads as one question per tab: how much and what kind of work
 * (Overview), then who (Members), where (Workspaces), and on what (Models, BYOK).
 * Only the visible tab's dimension is fetched, which is also the performance story —
 * half the dimensions heap-scan the ledger, and a tab nobody opens never pays for one.
 */
export function UsageMonitoring({ organizationId, workspaceId }: UsageMonitoringProps) {
  const router = useRouter()
  const { window, tab, workspace, preset, startDate, endDate, periodLabel, setState } =
    useUsageWindow()
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  /** The member whose credit limit is being edited, or null when the modal is closed. */
  const [creditsTarget, setCreditsTarget] = useState<ManageCreditsTarget | null>(null)

  const isOverview = tab === USAGE_OVERVIEW_TAB
  /** A selected workspace turns the Workspaces tab into that workspace's workflows. */
  const isWorkspaceDetail = tab === 'workspace' && Boolean(workspace)
  const dimension: UsageBreakdownDimension = isOverview
    ? 'source'
    : isWorkspaceDetail
      ? 'workflow'
      : (tab as UsageBreakdownDimension)

  /**
   * Per-member caps are hosted-only: the usage-limit route 404s where Sim does not
   * own billing, and there is no enforcement to hang a cap off. This panel is the
   * one organization surface a self-hosted enterprise can reach — Members is
   * `requiresHosted` with no self-hosted override — so without this the menu would
   * offer an action that could only fail.
   */
  const canManageCredits = tab === 'member' && isHosted

  const summary = useOrganizationUsageSummary(organizationId, window)
  const breakdown = useOrganizationUsageBreakdown(organizationId, window, dimension, {
    ...(isWorkspaceDetail && workspace ? { workspaceId: workspace } : {}),
  })
  /**
   * Kept alive in the drill-down purely to name it. The rule is to store the id and
   * derive the entity from the loaded list; arriving by click serves this from cache,
   * and arriving by deep link fetches it once.
   */
  const workspaceList = useOrganizationUsageBreakdown(organizationId, window, 'workspace', {
    enabled: isWorkspaceDetail,
  })
  const workspaceName = workspaceList.data?.rows.find((row) => row.id === workspace)?.label
  const workspaceSources = useOrganizationUsageBreakdown(organizationId, window, 'source', {
    enabled: isWorkspaceDetail,
    ...(workspace ? { workspaceId: workspace } : {}),
  })
  // Already cached by Members and Billing, so the meter costs nothing extra and
  // cannot report a different allowance than they do.
  const billing = useOrganizationBilling(organizationId)

  const handlePeriodChange = (value: string) => {
    if (value === 'custom') {
      setDatePickerOpen(true)
      return
    }
    void setState({ preset: value as typeof preset, startDate: null, endDate: null })
  }

  const handleDateRangeApply = (nextStart: string, nextEnd: string) => {
    void setState({ preset: 'custom', startDate: nextStart, endDate: nextEnd })
    setDatePickerOpen(false)
  }

  const handleExport = async () => {
    const params = new URLSearchParams({
      organizationId,
      preset: window.preset,
      timezone: window.timezone,
    })
    if (window.startDate) params.set('startDate', window.startDate)
    if (window.endDate) params.set('endDate', window.endDate)

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
  }

  /**
   * The drill-down is a detail view, so it takes over the header: a back chip out of
   * it, and the one action that belongs to a workspace rather than the organization.
   */
  if (isWorkspaceDetail && workspace) {
    return (
      <SettingsPanel
        // Opening pushed nothing (filters replace), so closing replaces too.
        back={{
          text: 'Workspaces',
          icon: ArrowLeft,
          onSelect: () => void setState({ workspace: null }),
        }}
        title={workspaceName ?? 'Workspace usage'}
        actions={[
          {
            text: 'Open logs',
            onSelect: () => router.push(`/workspace/${workspace}/logs`),
          },
        ]}
      >
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
          />
        </UsageSection>
        <UsageSection dimension='workflow' unit='credits'>
          <UsageConsumers
            dimension='workflow'
            breakdown={breakdown.data}
            isLoading={breakdown.isLoading}
            isError={breakdown.isError}
          />
        </UsageSection>
      </SettingsPanel>
    )
  }

  return (
    <SettingsPanel
      actions={[
        {
          text: 'All events',
          onSelect: () => router.push(`/workspace/${workspaceId}/settings/usage/events`),
        },
        {
          text: 'Export',
          icon: Download,
          onSelect: () => void handleExport(),
          disabled: summary.isLoading || summary.isError,
        },
      ]}
    >
      <div className='flex items-center justify-between gap-2'>
        <ChipModalTabs
          tabs={TABS}
          value={tab}
          onChange={(value) => void setState({ tab: value as UsageTab, workspace: null })}
        />
        <div className='relative flex-shrink-0'>
          {/* ChipCombobox (Radix Popover, non-modal), not ChipSelect (Radix
              DropdownMenu, modal by default) — a modal trigger closing in the
              same tick that opens the Calendar popover below traps it behind
              the modal's focus lock, so "Custom range" silently does nothing. */}
          <ChipCombobox
            options={PERIOD_OPTIONS}
            value={preset}
            onChange={handlePeriodChange}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{periodLabel}</span>
            }
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
              <Calendar
                mode='range'
                showTime
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
          <UsageSummary
            summary={summary.data}
            limitCredits={
              billing.data?.data?.totalUsageLimit != null
                ? dollarsToCredits(billing.data.data.totalUsageLimit)
                : null
            }
            isLoading={summary.isLoading}
            isError={summary.isError}
          />
          {/*
            "What kind of work was this?" belongs beside the total it explains, not
            behind a tab — it is the second half of the same sentence.
          */}
          <UsageSection dimension='source' unit='credits'>
            <UsageConsumers
              dimension='source'
              breakdown={breakdown.data}
              isLoading={breakdown.isLoading}
              isError={breakdown.isError}
            />
          </UsageSection>
        </>
      ) : (
        <UsageSection dimension={dimension} unit={dimension === 'byok' ? 'tokens' : 'credits'}>
          <UsageConsumers
            dimension={dimension}
            breakdown={breakdown.data}
            isLoading={breakdown.isLoading}
            isError={breakdown.isError}
            {...(tab === 'workspace'
              ? { onSelectRow: (row) => void setState({ workspace: row.id }) }
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

      {/*
        The same modal the Members settings page opens, driven by the same hooks —
        setting a cap here and there is one implementation, not two.
      */}
      <ManageCreditsModal
        key={creditsTarget?.userId ?? 'none'}
        open={creditsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCreditsTarget(null)
        }}
        organizationId={organizationId}
        member={creditsTarget}
      />
    </SettingsPanel>
  )
}
