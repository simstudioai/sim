'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  CreditLimitModal,
  type CreditLimitTarget,
} from '@/app/workspace/[workspaceId]/settings/components/organization-usage/components/credit-limit-modal'
import { MemberUsageTable } from '@/app/workspace/[workspaceId]/settings/components/organization-usage/components/member-usage-table'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useOrganizationMembers } from '@/hooks/queries/organization'

interface OrganizationUsageProps {
  organizationId: string
}

/**
 * Organization-plane Usage page. Owns the per-member view of organization
 * credit consumption: what each member spent this billing period, the credit
 * limit they carry, and the ability to change it.
 *
 * The whole roster — identity and usage together — arrives in one request
 * (`useOrganizationMembers` sends `?include=usage`), so the table filters in
 * memory and never pages. Per-member limits are a hosted-only feature; off the
 * hosted deployment the API 404s, so the page says so rather than rendering a
 * table it cannot fill.
 *
 * Expected to grow with organization-wide totals, a spend-over-time chart, and
 * a per-workspace breakdown — each a sibling under `components/`, with this
 * file staying the composition root.
 */
export function OrganizationUsage({ organizationId }: OrganizationUsageProps) {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [limitTarget, setLimitTarget] = useState<CreditLimitTarget | null>(null)
  const { data, isLoading, isError, error } = useOrganizationMembers(organizationId)

  if (!isHosted) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          Member credit usage is available on Sim&apos;s hosted service.
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  const members = data?.data ?? []
  /**
   * The roster route only attaches usage for organization admins, so a
   * non-admin viewer would otherwise get a table of blank credit columns.
   */
  const canManage = data?.hasAdminAccess ?? false

  const body = isError ? (
    <SettingsEmptyState tone='error'>
      {getErrorMessage(error, 'Failed to load member usage')}
    </SettingsEmptyState>
  ) : isLoading ? (
    <SettingsEmptyState>Loading...</SettingsEmptyState>
  ) : !canManage ? (
    <SettingsEmptyState>Only organization admins can view member usage</SettingsEmptyState>
  ) : members.length === 0 ? (
    <SettingsEmptyState>No members yet</SettingsEmptyState>
  ) : (
    <MemberUsageTable
      members={members}
      canManage={canManage}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      onEditLimit={setLimitTarget}
    />
  )

  return (
    <>
      <SettingsPanel>{body}</SettingsPanel>
      {canManage && (
        <CreditLimitModal
          key={limitTarget?.userId ?? 'none'}
          open={limitTarget !== null}
          onOpenChange={(open) => {
            if (!open) setLimitTarget(null)
          }}
          organizationId={organizationId}
          member={limitTarget}
        />
      )}
    </>
  )
}
