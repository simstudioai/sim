import { Body, Container, Head, Html, Img, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface HelpConfirmationEmailProps {
  type?: 'bug' | 'feedback' | 'feature_request' | 'other'
  attachmentCount?: number
  submittedDate?: Date
}

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
  type = 'other',
  attachmentCount = 0,
  submittedDate = new Date(),
}: HelpConfirmationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const typeLabel = getTypeLabel(type)

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your {typeLabel.toLowerCase()} has been received</Preview>

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
            <Text style={baseStyles.paragraph}>Hello,</Text>
            <Text style={baseStyles.paragraph}>
              We've received your <strong>{typeLabel.toLowerCase()}</strong> and will get back to
              you shortly.
            </Text>

            {attachmentCount > 0 && (
              <Text style={baseStyles.paragraph}>
                {attachmentCount} image{attachmentCount > 1 ? 's' : ''} attached.
              </Text>
            )}

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Submitted on {format(submittedDate, 'MMMM do, yyyy')}.
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default HelpConfirmationEmail
