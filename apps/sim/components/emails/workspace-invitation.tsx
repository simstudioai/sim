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
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getAssetUrl } from '@/lib/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

const logger = createLogger('WorkspaceInvitationEmail')

interface WorkspaceInvitationEmailProps {
  workspaceName?: string
  inviterName?: string
  invitationLink?: string
}

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

export const WorkspaceInvitationEmail = ({
  workspaceName = 'Workspace',
  inviterName = 'Someone',
  invitationLink = '',
}: WorkspaceInvitationEmailProps) => {
  const brand = getBrandConfig()

  // Extract token from the link to ensure we're using the correct format
  let enhancedLink = invitationLink

  try {
    // If the link is pointing to the API endpoint directly, update it to use the client route
    if (invitationLink.includes('/api/workspaces/invitations/accept')) {
      const url = new URL(invitationLink)
      const token = url.searchParams.get('token')
      if (token) {
        enhancedLink = `${baseUrl}/invite/${token}?token=${token}`
      }
    }
  } catch (e) {
    logger.error('Error enhancing invitation link:', e)
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>You've been invited to join the "{workspaceName}" workspace on Sim!</Preview>
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
              {inviterName} has invited you to join the "{workspaceName}" workspace on Sim!
            </Text>
            <Text style={baseStyles.paragraph}>
              Sim is a powerful platform for building, testing, and optimizing AI workflows. Join
              this workspace to collaborate with your team.
            </Text>
            <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Accept Invitation</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              This invitation link will expire in 7 days. If you have any questions or need
              assistance, feel free to reach out to our support team.
            </Text>
            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default WorkspaceInvitationEmail
