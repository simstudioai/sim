import { Link, Section, Text } from '@react-email/components'
import { baseStyles, colors, typography } from '@/components/emails/_styles'
import { proFeatures } from '@/components/emails/billing/constants'
import { EmailLayout } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBrandConfig } from '@/ee/whitelabeling'

interface FreeTierUpgradeEmailProps {
  userName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
}

export function FreeTierUpgradeEmail({
  userName,
  percentUsed,
  currentUsage,
  limit,
  upgradeLink,
}: FreeTierUpgradeEmailProps) {
  const brand = getBrandConfig()

  const previewText = `${brand.name}: You've used ${percentUsed}% of your free credits`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hi ${userName},` : 'Hi,'}
      </Text>

      <Text style={baseStyles.paragraph}>
        You've used <strong>{dollarsToCredits(currentUsage).toLocaleString()}</strong> of your{' '}
        <strong>{dollarsToCredits(limit).toLocaleString()}</strong> free credits ({percentUsed}%).
        Upgrade to Pro to keep building without interruption.
      </Text>

      {/* Pro Features */}
      <Section
        style={{
          backgroundColor: '#f8faf9',
          border: `1px solid ${colors.brandTertiary}20`,
          borderRadius: '8px',
          padding: '16px 20px',
          margin: '16px 0',
        }}
      >
        <Text
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: colors.brandTertiary,
            fontFamily: typography.fontFamily,
            margin: '0 0 12px 0',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.5px',
          }}
        >
          Pro includes
        </Text>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {proFeatures.map((feature, i) => (
              <tr key={i}>
                <td
                  style={{
                    padding: '6px 0',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: colors.textPrimary,
                    fontFamily: typography.fontFamily,
                    width: '45%',
                  }}
                >
                  {feature.label}
                </td>
                <td
                  style={{
                    padding: '6px 0',
                    fontSize: '14px',
                    color: colors.textMuted,
                    fontFamily: typography.fontFamily,
                  }}
                >
                  {feature.desc}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Link href={upgradeLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Upgrade to Pro</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        One-time notification at 80% usage.
      </Text>
    </EmailLayout>
  )
}

export default FreeTierUpgradeEmail
