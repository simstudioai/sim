'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { Icon } from '@sim/emcn/icon'
import { SettingsRow, SettingsSection, SettingsSurface } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import {
  BooleanRow,
  SavedSettingsSection,
} from '@/app/(product)/_components/settings-parts/saved-settings'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { ResourceList } from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { AwsMarketplaceSubscription } from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/aws-marketplace'
import {
  CreditUsage,
  CreditUsageGlance,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/credit-usage'
import { useBillingSection, useUsageLimitField } from '@/platform/lib/data/billing'

const ON_DEMAND_LABEL = 'Allow usage to go past included usage'
const ON_DEMAND_LOCKED =
  'Stays on while usage is above your plan’s included amount, at the latest until your billing period resets'

function UsageLimit(props: Parameters<typeof useUsageLimitField>[0]) {
  const field = useUsageLimitField(props)
  return (
    <SettingsSection title='Usage limit'>
      <SettingsRow
        label='Monthly limit, in credits'
        description='Max usage per month; 1,000 credits = $5'
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
  const creditUsage = subpath[0] === 'credit-usage'
  if (billing.status === 'pending') return creditUsage ? null : <SettingsPageHeader />
  if (billing.status === 'error')
    return (
      <>
        <SettingsPageHeader />
        <FailureNotice message={billing.error} onRetry={billing.retry} />
      </>
    )
  if (creditUsage) return <CreditUsage available={billing.showCreditUsage} />
  return (
    <>
      <SettingsPageHeader />
      <SettingsSurface>
        <SettingsRow
          label={billing.planTitle}
          description={billing.priceText}
          leading={<Icon name='I138' />}
        >
          {billing.showExplorePlans && (
            <Button
              render={
                billing.explorePlansHref ? <Link href={billing.explorePlansHref} /> : undefined
              }
              size='compact'
              disabled={!billing.explorePlansHref}
            >
              {billing.explorePlansLabel}
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
          personal={billing.usageLimit.personal}
        />
      )}
      {billing.showOnDemand && (
        <SettingsSection title='Enable on-demand usage'>
          <SwitchRow
            label={ON_DEMAND_LABEL}
            description={
              billing.onDemand.locked
                ? ON_DEMAND_LOCKED
                : 'Keep running past your plan’s included usage, billed as you go'
            }
            checked={billing.onDemand.locked || billing.onDemand.active}
            disabled={billing.onDemand.disabled}
            onCheckedChange={() => void billing.onDemand.toggle()}
          />
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
            <SettingsRow
              label={billing.periodEndLabel}
              description='When your current billing period ends'
            >
              <span data-type='T067'>{billing.periodEnd}</span>
            </SettingsRow>
          )}
          {billing.weeklyRefresh && (
            <SettingsRow label='Weekly refresh' description='Credits your plan adds back each week'>
              <span data-type='T067'>{billing.weeklyRefresh}</span>
            </SettingsRow>
          )}
          <SettingsRow
            label='Payment method'
            description='Update your card and billing details, and see every invoice, in Stripe'
          >
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
              description={
                billing.cancelled
                  ? 'Restore it to keep your plan after this period'
                  : 'Your plan stays active until the period ends'
              }
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
          <ResourceList>
            {billing.invoices.map((invoice) =>
              invoice.url ? (
                <ActivityRow
                  key={invoice.id}
                  title={invoice.date}
                  detail={`${invoice.amount} · ${invoice.description}`}
                  textMetadata={invoice.statusLabel}
                  density='comfortable'
                  render={<Link href={invoice.url} target='_blank' rel='noopener noreferrer' />}
                />
              ) : (
                <ActivityRow
                  key={invoice.id}
                  title={invoice.date}
                  detail={`${invoice.amount} · ${invoice.description}`}
                  textMetadata={invoice.statusLabel}
                  density='comfortable'
                  readOnly
                />
              )
            )}
          </ResourceList>
        </SettingsSection>
      )}
      {billing.showCreditUsage && <CreditUsageGlance />}
    </>
  )
}
