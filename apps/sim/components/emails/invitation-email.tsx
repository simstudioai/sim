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
import { getAssetUrl } from '@/lib/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface InvitationEmailProps {
  inviterName?: string
  organizationName?: string
  inviteLink?: string
  invitedEmail?: string
  updatedDate?: Date
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

export const InvitationEmail = ({
  inviterName = 'A team member',
  organizationName = 'an organization',
  inviteLink = '',
  invitedEmail = '',
  updatedDate = new Date(),
}: InvitationEmailProps) => {
  // Extract invitation ID or token from inviteLink if present
  let enhancedLink = inviteLink

  // Check if link contains an ID (old format) and append token parameter if needed
  if (inviteLink && !inviteLink.includes('token=')) {
    try {
      const url = new URL(inviteLink)
      const invitationId = url.pathname.split('/').pop()
      if (invitationId) {
        enhancedLink = `${baseUrl}/invite/${invitationId}?token=${invitationId}`
      }
    } catch (e) {
      console.error('Error parsing invite link:', e)
    }
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>You've been invited to join {organizationName} on Sim</Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={getAssetUrl('static/sim.png')}
                  width='114'
                  alt='Sim'
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
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{organizationName}</strong> on Sim. Sim is a powerful, user-friendly platform
              for building, testing, and optimizing agentic workflows.
            </Text>
            <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Accept Invitation</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              This invitation will expire in 48 hours. If you believe this invitation was sent in
              error, please ignore this email.
            </Text>
            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '40px',
                textAlign: 'left',
                color: '#666666',
              }}
            >
              This email was sent on {format(updatedDate, 'MMMM do, yyyy')} to {invitedEmail} with
              an invitation to join {organizationName} on Sim.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default InvitationEmail
