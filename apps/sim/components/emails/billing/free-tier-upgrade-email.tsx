import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles, colors, typography } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface FreeTierUpgradeEmailProps {
  userName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
}

const proFeatures = [
  { label: '$20/month', desc: 'in credits included' },
  { label: '25 runs/min', desc: 'sync executions' },
  { label: '200 runs/min', desc: 'async executions' },
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
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: You've used ${percentUsed}% of your free credits`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        {/* Main card container */}
        <Container style={baseStyles.container}>
          {/* Header with logo */}
          <Section style={baseStyles.header}>
            <Img
              src={brand.logoUrl || `${baseUrl}/brand/color/email/type.png`}
              width='70'
              alt={brand.name}
              style={{ display: 'block' }}
            />
          </Section>

          {/* Content */}
          <Section style={baseStyles.content}>
            <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
              {userName ? `Hi ${userName},` : 'Hi,'}
            </Text>

            <Text style={baseStyles.paragraph}>
              You've used <strong>${currentUsage.toFixed(2)}</strong> of your{' '}
              <strong>${limit.toFixed(2)}</strong> free credits ({percentUsed}%). Upgrade to Pro to
              keep building without interruption.
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
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default FreeTierUpgradeEmail
