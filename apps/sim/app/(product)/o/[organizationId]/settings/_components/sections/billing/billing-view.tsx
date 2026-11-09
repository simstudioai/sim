'use client'

import { Button } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { Icon } from '@sim/emcn/icon'
import { SettingsRow, SettingsSection, SettingsSurface } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { Tooltip } from '@sim/emcn/tooltip'
import {
  BooleanRow,
  SavedSettingsSection,
} from '@/app/(product)/_components/settings-parts/saved-settings'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { AwsMarketplaceSubscription } from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/aws-marketplace'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/billing.module.css'
import {
  CreditUsage,
  CreditUsageGlance,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/credit-usage'
import { useBillingSection, useUsageLimitField } from '@/platform/lib/data/billing'

const ON_DEMAND_LABEL = 'Allow usage to go past included usage'
const EXPLORE_PLANS_LABEL = 'Explore organization plans'
const ON_DEMAND_LOCKED =
  "Your usage is above your plan's included amount, so on-demand can't be turned off yet. It turns off once usage drops below it — at the latest when your billing period resets."

function UsageLimit(props: Parameters<typeof useUsageLimitField>[0]) {
  const field = useUsageLimitField(props)
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

export function BillingView({
  organization,
  subpath,
}: Pick<SettingsSectionProps, 'organization' | 'subpath'>) {
  const billing = useBillingSection(organization)
  if (billing.status === 'pending') return null
  if (billing.status === 'error')
    return <FailureNotice message={billing.error} onRetry={billing.retry} />
  if (subpath[0] === 'credit-usage') return <CreditUsage available={billing.showCreditUsage} />
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
      {billing.showUsageLimit && (
        <UsageLimit
          current={billing.usageLimit.current}
          minimum={billing.usageLimit.minimum}
          canEdit={billing.usageLimit.canEdit}
          organizationId={billing.usageLimit.organizationId}
        />
      )}
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
      {billing.showUsageNotifications && (
        <SavedSettingsSection title='Usage notifications'>
          <BooleanRow
            setting='billingUsageNotificationsEnabled'
            label='Email me when I reach 80% usage'
            description='Sent when usage reaches 80% of the monthly limit'
          />
        </SavedSettingsSection>
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
              disabled={!billing.canOpenPortal || billing.portalPending}
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
      <AwsMarketplaceSubscription
        organizationId={organization.organization.id}
        title='AWS Marketplace subscription'
      />
      <AwsMarketplaceSubscription
        organizationId={null}
        title='AWS Marketplace subscription on your account'
      />
      {billing.invoicesFailed && (
        <FailureNotice message='Couldn’t load invoices.' onRetry={billing.retryInvoices} />
      )}
      {billing.invoices.length > 0 && (
        <SettingsSection title='Invoices'>
          <ul className={styles.invoices}>
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
          </ul>
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
      {billing.showCreditUsage && <CreditUsageGlance />}
    </>
  )
}
