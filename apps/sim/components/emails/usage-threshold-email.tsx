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
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from './base-styles'

interface UsageThresholdEmailProps {
  userName?: string
  planName: string
  percentUsed: number
  currentUsage: number
  limit: number
  ctaLink: string
  updatedDate?: Date
}

export function UsageThresholdEmail({
  userName,
  planName,
  percentUsed,
  currentUsage,
  limit,
  ctaLink,
  updatedDate = new Date(),
}: UsageThresholdEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: You're at ${percentUsed}% of your ${planName} monthly budget`

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
              You're approaching your monthly budget on the {planName} plan.
            </Text>

            <Section>
              <Row>
                <Column>
                  <Text style={{ ...baseStyles.paragraph, marginBottom: 8 }}>
                    <strong>Usage</strong>
                  </Text>
                  <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
                    ${currentUsage.toFixed(2)} of ${limit.toFixed(2)} used ({percentUsed}%)
                  </Text>
                </Column>
              </Row>
            </Section>

            <Hr />

            <Text style={{ ...baseStyles.paragraph }}>
              To avoid interruptions, consider increasing your monthly limit.
            </Text>

            <Link href={ctaLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Review limits</Text>
            </Link>

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
            </Text>

            <Text style={{ ...baseStyles.paragraph, fontSize: '12px', color: '#666' }}>
              Sent on {updatedDate.toLocaleDateString()} • This is a one-time notification at 80%.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default UsageThresholdEmail
