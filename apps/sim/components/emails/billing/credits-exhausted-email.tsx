import { Link, Section, Text } from '@react-email/components'
import { baseStyles, colors, typography } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBrandConfig } from '@/ee/whitelabeling'

interface CreditsExhaustedEmailProps {
  userName?: string
  currentUsage: number
  limit: number
  upgradeLink: string
}

const proFeatures = [
  { label: '6,000 credits/month', desc: 'included' },
  { label: '+50 daily refresh', desc: 'credits per day' },
  { label: '150 runs/min', desc: 'sync executions' },
  { label: '50GB storage', desc: 'for files & assets' },
]

export function CreditsExhaustedEmail({
  userName,
  currentUsage,
  limit,
  upgradeLink,
}: CreditsExhaustedEmailProps) {
  const brand = getBrandConfig()

  return (
    <EmailLayout
      preview={`You've used all ${dollarsToCredits(limit).toLocaleString()} of your free ${brand.name} credits`}
      showUnsubscribe={true}
    >
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hi ${userName},` : 'Hi,'}
      </Text>

      <Text style={baseStyles.paragraph}>
        You&apos;ve used all <strong>{dollarsToCredits(currentUsage).toLocaleString()}</strong> of
        your free credits on {brand.name}. Your workflows are paused until you upgrade.
      </Text>

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

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        One-time notification when free credits are exhausted.
      </Text>
    </EmailLayout>
  )
}

export default CreditsExhaustedEmail
