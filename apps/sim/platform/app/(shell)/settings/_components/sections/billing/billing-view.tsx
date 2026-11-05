'use client'

import Link from 'next/link'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-skeleton/section-skeleton'
import { UnsavedChanges } from '@/platform/app/(shell)/settings/_components/unsaved-changes/unsaved-changes'
import {
  Button,
  DataTable,
  InlineNotice,
  StatusTag,
  Switch,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { useBillingSection, useUsageLimitField } from '@/platform/lib/data/billing'

const ON_DEMAND_LABEL = 'Allow usage to go past included usage'
const ON_DEMAND_LOCKED =
  "Your usage is above your plan's included amount, so on-demand can't be turned off yet. It turns off once usage drops below it, at the latest when your billing period resets."

const INVOICE_COLUMNS = [
  { key: 'date', label: 'Date', kind: 'text' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'amount', label: 'Amount', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'text', showFrom: 'compact' },
] as const

function UsageLimit(props: Parameters<typeof useUsageLimitField>[0]) {
  const field = useUsageLimitField(props)
  return (
    <SettingsSection title='Usage limit'>
      <SettingsRow
        label='Monthly limit, in credits'
        description="Max usage per month. 1,000 credits = $5. By default it's your plan's included usage, but you can set it beyond."
        field
      >
        <TextField
          label='Monthly limit, in credits'
          inputMode='numeric'
          value={field.value}
          placeholder={field.placeholder}
          disabled={field.disabled}
          onChange={field.change}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

export function BillingView({ organization }: Pick<SettingsSectionProps, 'organization'>) {
  const billing = useBillingSection(organization)
  if (billing.status === 'pending') return <SectionSkeleton title='Plan' rows={1} />
  if (billing.status === 'error')
    return (
      <InlineNotice
        intent='danger'
        message={billing.error}
        action={
          <Button
            variant='quiet'
            size='compact'
            disabled={billing.fetching}
            onClick={billing.retry}
          >
            Retry
          </Button>
        }
      />
    )
  return (
    <>
      <UnsavedChanges />
      <SettingsSection title='Plan'>
        <SettingsRow label={billing.planTitle} description={billing.priceText}>
          {billing.showExplorePlans &&
            (billing.explorePlansHref ? (
              <Button render={<Link href={billing.explorePlansHref} />} size='compact'>
                Explore organization plans
              </Button>
            ) : (
              <Button size='compact' disabled>
                Explore organization plans
              </Button>
            ))}
        </SettingsRow>
      </SettingsSection>
      {billing.showUsageLimit && (
        <UsageLimit
          current={billing.usageLimit.current}
          minimum={billing.usageLimit.minimum}
          canEdit={billing.usageLimit.canEdit}
          organizationId={billing.usageLimit.organizationId}
        />
      )}
      {billing.showOnDemand && (
        <SettingsSection title='On-demand usage'>
          <SettingsRow
            label={ON_DEMAND_LABEL}
            description={billing.onDemand.locked ? ON_DEMAND_LOCKED : undefined}
          >
            <Switch
              label={ON_DEMAND_LABEL}
              checked={billing.onDemand.locked || billing.onDemand.active}
              disabled={billing.onDemand.disabled}
              onCheckedChange={() => void billing.onDemand.toggle()}
            />
          </SettingsRow>
        </SettingsSection>
      )}
      {billing.showSubscription && (
        <SettingsSection title='Subscription'>
          {billing.periodEnd && (
            <SettingsRow label={billing.periodEndLabel}>
              <span data-type='T067'>{billing.periodEnd}</span>
            </SettingsRow>
          )}
          {billing.weeklyRefresh && (
            <SettingsRow label='Weekly refresh'>
              <span data-type='T067'>{billing.weeklyRefresh}</span>
            </SettingsRow>
          )}
          <SettingsRow label='Payment method'>
            <Button
              size='compact'
              disabled={!billing.canManage || billing.portalPending}
              onClick={billing.openPortal}
            >
              Manage in Stripe
            </Button>
          </SettingsRow>
          {billing.showCancellation && (
            <SettingsRow
              label={billing.cancelled ? 'Subscription canceled' : 'Cancel subscription'}
            >
              {billing.cancelled ? (
                <Button
                  variant='primary'
                  size='compact'
                  disabled={!billing.canManage}
                  onClick={() => void billing.restore()}
                >
                  Restore
                </Button>
              ) : (
                <Button
                  variant='destructive'
                  size='compact'
                  disabled={!billing.canManage}
                  onClick={() => void billing.cancel()}
                >
                  Cancel
                </Button>
              )}
            </SettingsRow>
          )}
        </SettingsSection>
      )}
      {billing.invoices.length > 0 && (
        <DataTable
          title='Invoices'
          control={
            billing.hasMoreInvoices ? (
              <Button
                variant='quiet'
                size='compact'
                disabled={billing.portalPending || !billing.canManage}
                onClick={billing.openPortal}
              >
                View all
              </Button>
            ) : undefined
          }
          columns={INVOICE_COLUMNS}
          rows={billing.invoices.map((invoice) => ({
            id: invoice.id,
            values: {
              date: invoice.date,
              amount: invoice.amount,
              description: invoice.description,
            },
            cells: {
              status: <StatusTag label={invoice.statusLabel} intent={invoice.statusIntent} />,
            },
            onOpen: invoice.url
              ? () => window.open(invoice.url ?? undefined, '_blank', 'noopener,noreferrer')
              : undefined,
          }))}
        />
      )}
    </>
  )
}
