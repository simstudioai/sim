import { Link, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { UPGRADE_REASON_COPY, type UpgradeReason } from '@/lib/billing/upgrade-reasons'
import { getBrandConfig } from '@/ee/whitelabeling'

interface LimitThresholdEmailProps {
  /** `warning` = approaching the limit (~80%); `reached` = at/over the limit. */
  kind: 'warning' | 'reached'
  /** Limit category, drives the shared copy. */
  reason: UpgradeReason
  userName?: string
  /** Pre-formatted current usage, e.g. "4.2 GB", "48,000 rows", "9 seats". */
  usageLabel: string
  /** Pre-formatted limit, e.g. "5 GB", "50,000 rows", "10 seats". */
  limitLabel: string
  percentUsed: number
  upgradeLink: string
}

/**
 * Single template for the per-category usage-limit emails (storage, tables,
 * seats). Copy comes from {@link UPGRADE_REASON_COPY} so the email language
 * matches the upgrade-page header the user lands on.
 */
export function LimitThresholdEmail({
  kind,
  reason,
  userName,
  usageLabel,
  limitLabel,
  percentUsed,
  upgradeLink,
}: LimitThresholdEmailProps) {
  const brand = getBrandConfig()
  const copy = UPGRADE_REASON_COPY[reason]
  const lead = kind === 'reached' ? copy.reachedLead : copy.warningLead
  const previewText = `${brand.name}: ${lead}`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hi ${userName},` : 'Hi,'}
      </Text>

      <Text style={baseStyles.paragraph}>
        {lead} Upgrade your plan for more {copy.noun}.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Usage</Text>
        <Text style={baseStyles.infoBoxList}>
          {usageLabel} of {limitLabel} used ({percentUsed}%)
        </Text>
      </Section>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Link href={upgradeLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Upgrade</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        {kind === 'reached'
          ? 'One-time notification at 100% usage.'
          : 'One-time notification at 80% usage.'}
      </Text>
    </EmailLayout>
  )
}

export default LimitThresholdEmail
