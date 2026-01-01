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
import { baseStyles, colors } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

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

            <Text
              style={{
                ...baseStyles.paragraph,
                fontSize: '16px',
                fontWeight: 600,
                color: colors.textPrimary,
              }}
            >
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
                borderRadius: '6px',
                padding: '16px 18px',
                margin: '16px 0',
              }}
            >
              <Text
                style={{
                  ...baseStyles.paragraph,
                  marginBottom: 8,
                  marginTop: 0,
                  fontWeight: 'bold',
                }}
              >
                Payment Details
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
            </Section>

            <Link href={billingPortalUrl} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Update Payment Method</Text>
            </Link>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.paragraph, fontWeight: 'bold' }}>What happens next?</Text>

            <Text style={baseStyles.paragraph}>
              • Your workflows and automations are currently paused
              <br />• Update your payment method to restore service immediately
              <br />• Stripe will automatically retry the charge once payment is updated
            </Text>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Common issues: expired card, insufficient funds, or incorrect billing info. Need help?{' '}
              <Link href={`${baseUrl}/support`} style={baseStyles.link}>
                Contact support
              </Link>
              .
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default PaymentFailedEmail
