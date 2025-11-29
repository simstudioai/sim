import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

interface FreeTierUpgradeEmailProps {
  userName?: string
  percentUsed: number
  currentUsage: number
  limit: number
  upgradeLink: string
  updatedDate?: Date
}

export function FreeTierUpgradeEmail({
  userName,
  percentUsed,
  currentUsage,
  limit,
  upgradeLink,
  updatedDate = new Date(),
}: FreeTierUpgradeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: You've used ${percentUsed}% of your free credits`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={brand.logoUrl || `${baseUrl}/logo/reverse/text/medium.png`}
                  width='114'
                  alt={brand.name}
                  style={{
                    margin: '0 auto',
                  }}
                />
              </Column>
            </Row>
          </Section>

          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>

          <Section style={baseStyles.content}>
            <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
              {userName ? `Hi ${userName},` : 'Hi,'}
            </Text>

            <Text style={baseStyles.paragraph}>
              You've used <strong>${currentUsage.toFixed(2)}</strong> of your{' '}
              <strong>${limit.toFixed(2)}</strong> free credits ({percentUsed}%).
            </Text>

            <Text style={baseStyles.paragraph}>
              To ensure uninterrupted service and unlock the full power of {brand.name}, upgrade to
              Pro today.
            </Text>

            <Section
              style={{
                backgroundColor: '#f8f9fa',
                padding: '20px',
                borderRadius: '5px',
                margin: '20px 0',
              }}
            >
              <Text
                style={{
                  ...baseStyles.paragraph,
                  marginTop: 0,
                  marginBottom: 12,
                  fontWeight: 'bold',
                }}
              >
                What you get with Pro:
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '8px 0', lineHeight: 1.6 }}>
                • <strong>$20/month in credits</strong> – 2x your free tier
                <br />• <strong>Priority support</strong> – Get help when you need it
                <br />• <strong>Advanced features</strong> – Access to premium blocks and
                integrations
                <br />• <strong>No interruptions</strong> – Never worry about running out of credits
              </Text>
            </Section>

            <Hr />

            <Text style={baseStyles.paragraph}>Upgrade now to keep building without limits.</Text>

            <Link href={upgradeLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Upgrade to Pro</Text>
            </Link>

            <Text style={baseStyles.paragraph}>
              Questions? We're here to help.
              <br />
              <br />
              Best regards,
              <br />
              The {brand.name} Team
            </Text>

            <Text style={{ ...baseStyles.paragraph, fontSize: '12px', color: '#666' }}>
              Sent on {updatedDate.toLocaleDateString()} • This is a one-time notification at 90%.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default FreeTierUpgradeEmail
