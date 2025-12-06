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
import { getBaseUrl } from '@/lib/core/utils/urls'

interface CreditPurchaseEmailProps {
  userName?: string
  amount: number
  newBalance: number
  purchaseDate?: Date
}

export function CreditPurchaseEmail({
  userName,
  amount,
  newBalance,
  purchaseDate = new Date(),
}: CreditPurchaseEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: $${amount.toFixed(2)} in credits added to your account`

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
              Your credit purchase of <strong>${amount.toFixed(2)}</strong> has been confirmed.
            </Text>

            <Section
              style={{
                background: '#f4f4f5',
                borderRadius: '8px',
                padding: '16px',
                margin: '24px 0',
              }}
            >
              <Text style={{ margin: 0, fontSize: '14px', color: '#71717a' }}>Amount Added</Text>
              <Text style={{ margin: '4px 0 16px', fontSize: '24px', fontWeight: 'bold' }}>
                ${amount.toFixed(2)}
              </Text>
              <Text style={{ margin: 0, fontSize: '14px', color: '#71717a' }}>New Balance</Text>
              <Text style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 'bold' }}>
                ${newBalance.toFixed(2)}
              </Text>
            </Section>

            <Text style={baseStyles.paragraph}>
              These credits will be applied automatically to your workflow executions. Credits are
              consumed before any overage charges apply.
            </Text>

            <Link href={`${baseUrl}/workspace`} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>View Dashboard</Text>
            </Link>

            <Hr />

            <Text style={baseStyles.paragraph}>
              You can view your credit balance and purchase history in Settings → Subscription.
            </Text>

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
            </Text>

            <Text style={{ ...baseStyles.paragraph, fontSize: '12px', color: '#666' }}>
              Purchased on {purchaseDate.toLocaleDateString()}
            </Text>
          </Section>
        </Container>
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default CreditPurchaseEmail
