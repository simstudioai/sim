import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { getAssetUrl } from '@/lib/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface HelpConfirmationEmailProps {
  userEmail?: string
  type?: 'bug' | 'feedback' | 'feature_request' | 'other'
  attachmentCount?: number
  submittedDate?: Date
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'bug':
      return 'Bug Report'
    case 'feedback':
      return 'Feedback'
    case 'feature_request':
      return 'Feature Request'
    case 'other':
      return 'General Inquiry'
    default:
      return 'Request'
  }
}

export const HelpConfirmationEmail = ({
  userEmail = '',
  type = 'other',
  attachmentCount = 0,
  submittedDate = new Date(),
}: HelpConfirmationEmailProps) => {
  const brand = getBrandConfig()
  const typeLabel = getTypeLabel(type)

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your {typeLabel.toLowerCase()} has been received</Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={brand.logoUrl || getAssetUrl('static/sim.png')}
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
            <Text style={baseStyles.paragraph}>Hello,</Text>
            <Text style={baseStyles.paragraph}>
              Thank you for your <strong>{typeLabel.toLowerCase()}</strong> submission. We've
              received your request and will get back to you as soon as possible.
            </Text>

            {attachmentCount > 0 && (
              <Text style={baseStyles.paragraph}>
                You attached{' '}
                <strong>
                  {attachmentCount} image{attachmentCount > 1 ? 's' : ''}
                </strong>{' '}
                with your request.
              </Text>
            )}

            <Text style={baseStyles.paragraph}>
              We typically respond to{' '}
              {type === 'bug'
                ? 'bug reports'
                : type === 'feature_request'
                  ? 'feature requests'
                  : 'inquiries'}{' '}
              within a few hours. If you need immediate assistance, please don't hesitate to reach
              out to us directly.
            </Text>

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The {brand.name} Team
            </Text>

            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '40px',
                textAlign: 'left',
                color: '#666666',
              }}
            >
              This confirmation was sent on {format(submittedDate, 'MMMM do, yyyy')} for your{' '}
              {typeLabel.toLowerCase()} submission from {userEmail}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default HelpConfirmationEmail
