'use client'

import {
  Button,
  FailureNotice,
  Icon,
  Input,
  RowList,
  StatusTag,
  Switch,
  Tooltip,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import { SectionSkeleton } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/billing/billing.module.css'
import { useBillingSection } from '@/platform/embedded/lib/data/billing'

const ON_DEMAND_LABEL = 'Allow usage to go past included usage'
const EXPLORE_PLANS_LABEL = 'Explore organization plans'
const ON_DEMAND_LOCKED =
  "Your usage is above your plan's included amount, so on-demand can't be turned off yet. It turns off once usage drops below it — at the latest when your billing period resets."

function UsageLimit({ field }: { field: ReturnType<typeof useBillingSection>['usageLimit'] }) {
  return (
    <SettingsSection title='Usage limit'>
      <SettingsRow
        label='Monthly limit, in credits'
        description="Max usage per month. 1,000 credits = $5. By default it's your plan's included usage, but you can set it beyond."
        field
      >
        <Input
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
    return <FailureNotice message={billing.error} onRetry={billing.retry} />
  return (
    <>
      <SettingsSurface>
        <SettingsRow
          label={billing.planTitle}
          description={billing.priceText}
          leading={<Icon name='I138' />}
        >
          {billing.showExplorePlans && (
            <Button
              render={
                billing.explorePlansHref ? (
                  <a href={billing.explorePlansHref}>{EXPLORE_PLANS_LABEL}</a>
                ) : undefined
              }
              size='compact'
              disabled={!billing.explorePlansHref}
            >
              {EXPLORE_PLANS_LABEL}
            </Button>
          )}
        </SettingsRow>
      </SettingsSurface>
      {billing.showUsageLimit && <UsageLimit field={billing.usageLimit} />}
      {billing.showOnDemand && (
        <SettingsSection title='Enable on-demand usage'>
          <SettingsRow label={ON_DEMAND_LABEL}>
            <Tooltip enabled={billing.onDemand.locked} label={ON_DEMAND_LOCKED}>
              <span>
                <Switch
                  label={ON_DEMAND_LABEL}
                  checked={billing.onDemand.locked || billing.onDemand.active}
                  disabled={billing.onDemand.disabled}
                  onCheckedChange={() => void billing.onDemand.toggle()}
                />
              </span>
            </Tooltip>
          </SettingsRow>
        </SettingsSection>
      )}
      {billing.showSubscription && (
        <SettingsSection title='Billing details'>
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
            <Tooltip enabled={!billing.canOpenPortal} label={billing.portalDisabledReason}>
              <span>
                <Button
                  size='compact'
                  disabled={!billing.canOpenPortal || billing.portalPending}
                  onClick={billing.openPortal}
                >
                  Manage in Stripe
                </Button>
              </span>
            </Tooltip>
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
      {billing.invoicesFailed && (
        <FailureNotice message='Couldn’t load invoices.' onRetry={billing.retryInvoices} />
      )}
      {billing.invoices.length > 0 && (
        <SettingsSection title='Invoices'>
          <RowList>
            {billing.invoices.map((invoice) => {
              const details = (
                <>
                  <span data-type='T059'>{invoice.date}</span>
                  <StatusTag label={invoice.statusLabel} intent={invoice.statusIntent} />
                  <span data-type='T060'>{invoice.amount}</span>
                  <span className={styles.description} data-type='T060'>
                    {invoice.description}
                  </span>
                  <Icon name='I032' />
                </>
              )
              // Not an ActivityRow: an invoice is several tabular columns, and most but not all open.
              return (
                <li key={invoice.id}>
                  {invoice.url ? (
                    <a
                      className={styles.invoice}
                      href={invoice.url}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      {details}
                    </a>
                  ) : (
                    <div className={styles.invoice}>{details}</div>
                  )}
                </li>
              )
            })}
          </RowList>
          {billing.hasMoreInvoices && (
            <Button
              size='compact'
              disabled={!billing.canOpenPortal || billing.portalPending}
              onClick={billing.openPortal}
            >
              View all invoices
            </Button>
          )}
        </SettingsSection>
      )}
    </>
  )
}
