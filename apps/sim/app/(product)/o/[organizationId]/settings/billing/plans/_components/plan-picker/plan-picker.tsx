'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  DirectoryBack,
  DirectoryHeading,
  DirectoryPage,
} from '@/app/(product)/_components/resource-directory/resource-directory'
import { usePlanHost, usePlanPicker } from '@/platform/lib/data/plans'
import { platformHref } from '@/platform/lib/navigation'

interface PlanPickerProps {
  organizationId: string
  /** The page heading, chosen by the limit that sent the viewer here. */
  header: string
}

/** The organization's plans, reached from Billing's Explore plans and from usage-limit prompts. */
export function PlanPicker({ organizationId, header }: PlanPickerProps) {
  const search = useSearchParams()
  const billingHref = platformHref('/settings/billing', search)
  const host = usePlanHost(organizationId)
  return (
    <DirectoryPage>
      <DirectoryBack href={billingHref} label='Billing' />
      {host.status === 'ready' ? (
        <Plans header={header} billingHref={billingHref} host={host} />
      ) : (
        <>
          <DirectoryHeading title={header} />
          {host.status === 'error' && <FailureNotice message={host.message} onRetry={host.retry} />}
          {host.status === 'none' && (
            <EmptyState
              title='Plans unavailable'
              description='This organization has no workspace to bill yet.'
            />
          )}
        </>
      )}
    </DirectoryPage>
  )
}

interface PlansProps {
  header: string
  billingHref: string
  host: Extract<ReturnType<typeof usePlanHost>, { status: 'ready' }>
}

function Plans({ header, billingHref, host }: PlansProps) {
  const router = useRouter()
  const [comparing, setComparing] = useState(false)
  const picker = usePlanPicker({
    hostContext: host.hostContext,
    workspaceId: host.workspaceId,
    onLeave: () => router.replace(billingHref),
  })
  if (picker.hidden) return null
  if (picker.unavailable)
    return (
      <>
        <DirectoryHeading title={header} />
        <EmptyState
          title='Plans unavailable'
          description={picker.unavailable.description}
          action={
            picker.unavailable.retry && (
              <Button
                variant='secondary'
                disabled={picker.unavailable.retry.pending}
                onClick={picker.unavailable.retry.run}
              >
                {picker.unavailable.retry.pending ? 'Retrying…' : 'Try again'}
              </Button>
            )
          }
        />
      </>
    )
  return (
    <>
      <DirectoryHeading
        title={header}
        action={
          picker.showPlans && (
            <SegmentedControl
              label='Billing period'
              value={picker.annual ? 'annual' : 'monthly'}
              onSelect={(period) => picker.setAnnual(period === 'annual')}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: 'Annual' },
              ]}
            />
          )
        }
      />
      {picker.showPlans && (
        <>
          {picker.plans.map((plan) => (
            <SettingsSection key={plan.id} title={plan.name}>
              <SettingsRow
                label={plan.segment}
                description={[plan.price, plan.priceDetail, plan.discount]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {plan.current && <StatusTag label='Your plan' />}
                <Button
                  size='compact'
                  variant={plan.cta.primary ? 'primary' : 'secondary'}
                  disabled={plan.cta.disabled}
                  onClick={plan.cta.onClick}
                  aria-label={`${plan.cta.label}: ${plan.name}`}
                >
                  {plan.cta.label}
                </Button>
              </SettingsRow>
              <SettingsRow label={plan.credits} description={plan.refresh} />
              <SettingsRow label='Includes' description={plan.features.join(' · ')} />
            </SettingsSection>
          ))}
          <div>
            <Button variant='quiet' size='compact' onClick={() => setComparing((open) => !open)}>
              {comparing ? 'Hide all features' : 'Show all features'}
            </Button>
          </div>
          {comparing &&
            picker.comparison.sections.map((section) => (
              <DataTable
                key={section.title}
                title={section.title}
                columns={[
                  { key: 'label', label: 'Feature', kind: 'text', primary: true },
                  ...picker.comparison.plans.map((plan) => ({
                    key: plan.key,
                    label: plan.label,
                    kind: 'text' as const,
                  })),
                ]}
                rows={section.rows.map((row) => ({
                  id: row.id,
                  values: { label: row.label, ...row.values },
                }))}
              />
            ))}
        </>
      )}
    </>
  )
}
