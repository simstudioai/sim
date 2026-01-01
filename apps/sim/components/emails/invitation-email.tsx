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
import { createLogger } from '@sim/logger'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface InvitationEmailProps {
  inviterName?: string
  organizationName?: string
  inviteLink?: string
}

const logger = createLogger('InvitationEmail')

export const InvitationEmail = ({
  inviterName = 'A team member',
  organizationName = 'an organization',
  inviteLink = '',
}: InvitationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  let enhancedLink = inviteLink

  if (inviteLink && !inviteLink.includes('token=')) {
    try {
      const url = new URL(inviteLink)
      const invitationId = url.pathname.split('/').pop()
      if (invitationId) {
        enhancedLink = `${baseUrl}/invite/${invitationId}?token=${invitationId}`
      }
    } catch (e) {
      logger.error('Error parsing invite link:', e)
    }
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          You've been invited to join {organizationName} on {brand.name}
        </Preview>

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
              <strong>{inviterName}</strong> invited you to join <strong>{organizationName}</strong>{' '}
              on {brand.name}.
            </Text>

            <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Accept Invitation</Text>
            </Link>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Invitation expires in 48 hours. If unexpected, you can ignore this email.
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default InvitationEmail
