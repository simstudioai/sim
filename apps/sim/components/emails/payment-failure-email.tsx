import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { format } from 'date-fns'
import { env } from '@/lib/env'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface PaymentFailureEmailProps {
  customerEmail?: string
  failedAmount?: number
  planName?: string
  billingPeriod?: string
  invoiceId?: string
  invoiceUrl?: string
  attemptCount?: number
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

export const PaymentFailureEmail = ({
  customerEmail = 'customer@example.com',
  failedAmount = 0,
  planName = 'Pro',
  billingPeriod = 'this month',
  invoiceId = 'inv_example',
  invoiceUrl = '',
  attemptCount = 1,
}: PaymentFailureEmailProps) => {
  const dashboardUrl = `${baseUrl}/workspace`

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Payment Failed - Action Required for ${failedAmount.toFixed(2)} charge</Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={`${baseUrl}/static/sim.png`}
                  width='114'
                  alt='Sim Studio'
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
            <Text
              style={{
                ...baseStyles.paragraph,
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#dc3545',
                textAlign: 'center',
                margin: '0 0 30px 0',
              }}
            >
              ⚠️ Payment Failed
            </Text>

            <Text style={baseStyles.paragraph}>
              We were unable to process your payment of <strong>${failedAmount.toFixed(2)}</strong>{' '}
              for {billingPeriod}.
            </Text>

            <Section
              style={{
                backgroundColor: '#fff3cd',
                padding: '20px',
                borderRadius: '8px',
                margin: '20px 0',
                borderLeft: '4px solid #ffc107',
              }}
            >
              <Text
                style={{
                  ...baseStyles.paragraph,
                  margin: '0 0 15px 0',
                  fontWeight: 'bold',
                  color: '#856404',
                }}
              >
                Failed Payment Details
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0', color: '#856404' }}>
                <strong>Plan:</strong> {planName}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0', color: '#856404' }}>
                <strong>Amount:</strong> ${failedAmount.toFixed(2)}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0', color: '#856404' }}>
                <strong>Period:</strong> {billingPeriod}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0', color: '#856404' }}>
                <strong>Invoice ID:</strong> {invoiceId}
              </Text>
              {attemptCount > 1 && (
                <Text style={{ ...baseStyles.paragraph, margin: '5px 0', color: '#856404' }}>
                  <strong>Attempt:</strong> {attemptCount}
                </Text>
              )}
            </Section>

            <Section
              style={{
                backgroundColor: '#d1ecf1',
                padding: '15px',
                borderRadius: '8px',
                margin: '20px 0',
              }}
            >
              <Text style={{ ...baseStyles.paragraph, margin: '0 0 10px 0', fontWeight: 'bold' }}>
                What happens next?
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                • Stripe will automatically retry your payment
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                • Please ensure your payment method is up to date
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                • Your service will continue normally during retry attempts
              </Text>
            </Section>

            <Link href={dashboardUrl} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Update Payment Method</Text>
            </Link>

            {invoiceUrl && (
              <Text style={baseStyles.paragraph}>
                You can{' '}
                <Link href={invoiceUrl} style={baseStyles.link}>
                  view the failed invoice
                </Link>{' '}
                and update your payment method in your Sim Studio dashboard.
              </Text>
            )}

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Studio Team
            </Text>

            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '40px',
                textAlign: 'left',
                color: '#666666',
              }}
            >
              This payment failure notification was sent on {format(new Date(), 'MMMM do, yyyy')} to{' '}
              {customerEmail}. If you need assistance with payment issues, please contact our
              support team.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default PaymentFailureEmail
