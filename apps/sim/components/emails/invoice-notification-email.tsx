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

interface InvoiceNotificationEmailProps {
  customerEmail?: string
  invoiceAmount?: number
  planName?: string
  billingPeriod?: string
  invoiceId?: string
  invoiceUrl?: string
  dueDate?: string
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

export const InvoiceNotificationEmail = ({
  customerEmail = 'customer@example.com',
  invoiceAmount = 0,
  planName = 'Pro',
  billingPeriod = 'this month',
  invoiceId = 'inv_example',
  invoiceUrl = '',
  dueDate = 'immediately',
}: InvoiceNotificationEmailProps) => {
  const dashboardUrl = `${baseUrl}/workspace`

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          Usage Invoice - ${invoiceAmount.toFixed(2)} for {billingPeriod}
        </Preview>
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
                color: '#333',
                textAlign: 'center',
                margin: '0 0 30px 0',
              }}
            >
              📋 Usage Invoice
            </Text>

            <Text style={baseStyles.paragraph}>
              Your usage invoice for {billingPeriod} is ready and will be automatically processed.
            </Text>

            <Section
              style={{
                backgroundColor: '#f8f9fa',
                padding: '20px',
                borderRadius: '8px',
                margin: '20px 0',
              }}
            >
              <Text
                style={{
                  ...baseStyles.paragraph,
                  margin: '0 0 15px 0',
                  fontWeight: 'bold',
                }}
              >
                Invoice Details
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                <strong>Plan:</strong> {planName}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                <strong>Amount Due:</strong> ${invoiceAmount.toFixed(2)}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                <strong>Period:</strong> {billingPeriod}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                <strong>Due Date:</strong> {dueDate}
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '5px 0' }}>
                <strong>Invoice ID:</strong> {invoiceId}
              </Text>
            </Section>

            <Section
              style={{
                backgroundColor: '#d4edda',
                padding: '15px',
                borderRadius: '8px',
                margin: '20px 0',
              }}
            >
              <Text style={{ ...baseStyles.paragraph, margin: '0 0 10px 0', fontWeight: 'bold' }}>
                Payment Information
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '0' }}>
                Payment will be automatically attempted using your default payment method. No action
                is required from you.
              </Text>
            </Section>

            <Link href={dashboardUrl} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>View Dashboard</Text>
            </Link>

            {invoiceUrl && (
              <Text style={baseStyles.paragraph}>
                You can{' '}
                <Link href={invoiceUrl} style={baseStyles.link}>
                  view the detailed invoice
                </Link>{' '}
                and manage your payment methods in your Sim Studio dashboard.
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
              This invoice notification was sent on {format(new Date(), 'MMMM do, yyyy')} to{' '}
              {customerEmail}. Questions about your usage or billing? Contact our support team.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default InvoiceNotificationEmail
