import { Link, Section, Text } from '@react-email/components'
import { baseStyles, colors, typography } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface FreeTierUpgradeEmailProps {
  userName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
}

const proFeatures = [
  { label: '$20/month', desc: 'in credits included' },
  { label: '150 runs/min', desc: 'sync executions' },
  { label: '1,000 runs/min', desc: 'async executions' },
  { label: '50GB storage', desc: 'for files & assets' },
  { label: 'Unlimited', desc: 'workspaces & invites' },
]

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
        You've used <strong>${currentUsage.toFixed(2)}</strong> of your{' '}
        <strong>${limit.toFixed(2)}</strong> free credits ({percentUsed}%). Upgrade to Pro to keep
        building without interruption.
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
        One-time notification at 90% usage.
      </Text>
    </EmailLayout>
  )
}

export default FreeTierUpgradeEmail
