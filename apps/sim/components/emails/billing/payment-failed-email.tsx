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

interface PaymentFailedEmailProps {
  userName?: string
  amountDue: number
  lastFourDigits?: string
  billingPortalUrl: string
  failureReason?: string
  sentDate?: Date
}

export function PaymentFailedEmail({
  userName,
  amountDue,
  lastFourDigits,
  billingPortalUrl,
  failureReason,
  sentDate = new Date(),
}: PaymentFailedEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: Payment Failed - Action Required`

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

            <Text style={{ ...baseStyles.paragraph, fontSize: '18px', fontWeight: 'bold' }}>
              We were unable to process your payment.
            </Text>

            <Text style={baseStyles.paragraph}>
              Your {brand.name} account has been temporarily blocked to prevent service
              interruptions and unexpected charges. To restore access immediately, please update
              your payment method.
            </Text>

            <Section
              style={{
                backgroundColor: '#fff5f5',
                border: '1px solid #fed7d7',
                borderRadius: '5px',
                padding: '16px',
                margin: '20px 0',
              }}
            >
              <Row>
                <Column>
                  <Text style={{ ...baseStyles.paragraph, marginBottom: 8, marginTop: 0 }}>
                    <strong>Payment Details</strong>
                  </Text>
                  <Text style={{ ...baseStyles.paragraph, margin: '4px 0' }}>
                    Amount due: ${amountDue.toFixed(2)}
                  </Text>
                  {lastFourDigits && (
                    <Text style={{ ...baseStyles.paragraph, margin: '4px 0' }}>
                      Payment method: •••• {lastFourDigits}
                    </Text>
                  )}
                  {failureReason && (
                    <Text style={{ ...baseStyles.paragraph, margin: '4px 0' }}>
                      Reason: {failureReason}
                    </Text>
                  )}
                </Column>
              </Row>
            </Section>

            <Link href={billingPortalUrl} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Update Payment Method</Text>
            </Link>

            <Hr />

            <Text style={baseStyles.paragraph}>
              <strong>What happens next?</strong>
            </Text>

            <Text style={baseStyles.paragraph}>
              • Your workflows and automations are currently paused
              <br />• Update your payment method to restore service immediately
              <br />• Stripe will automatically retry the charge once payment is updated
            </Text>

            <Hr />

            <Text style={baseStyles.paragraph}>
              <strong>Need help?</strong>
            </Text>

            <Text style={baseStyles.paragraph}>
              Common reasons for payment failures include expired cards, insufficient funds, or
              incorrect billing information. If you continue to experience issues, please{' '}
              <Link href={`${baseUrl}/support`} style={baseStyles.link}>
                contact our support team
              </Link>
              .
            </Text>

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
            </Text>

            <Text style={{ ...baseStyles.paragraph, fontSize: '12px', color: '#666' }}>
              Sent on {sentDate.toLocaleDateString()} • This is a critical transactional
              notification.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default PaymentFailedEmail
