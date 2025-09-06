import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { getAssetUrl } from '@/lib/utils'

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
  const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

  const previewText = `${brand.name}: You're at ${percentUsed}% of your ${planName} monthly budget`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        <Container style={baseStyles.container}>
          <Section style={baseStyles.header}>
            <Img
              src={getAssetUrl('logo-sim.svg')}
              alt={`${brand.name} Logo`}
              width='80'
              height='80'
            />
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

            <Button style={baseStyles.button} href={ctaLink} rel='noopener noreferrer'>
              Review limits
            </Button>

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
