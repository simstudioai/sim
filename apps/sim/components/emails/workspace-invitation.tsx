import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  Row,
  Column,
} from '@react-email/components'
import { whitelabelConfig } from '@/lib/whitelabel'

interface WorkspaceInvitationEmailProps {
  workspaceName: string
  inviteUrl: string
  inviterName?: string
  inviterEmail?: string
}

const baseUrl = whitelabelConfig.appUrl

const baseStyles = {
  main: {
    backgroundColor: '#ffffff',
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
  },
  container: {
    margin: '0 auto',
    padding: '20px 0 48px',
    maxWidth: '560px',
  },
  sectionsBorders: {
    width: '100%',
    borderBottom: '1px solid #e6ebf1',
    borderLeft: '1px solid #e6ebf1',
    borderRight: '1px solid #e6ebf1',
  },
  sectionBorder: {
    borderBottom: '1px solid #e6ebf1',
    borderLeft: '1px solid #e6ebf1',
    borderRight: '1px solid #e6ebf1',
  },
  sectionCenter: {
    padding: '0 40px',
  },
  section: {
    padding: '0 40px',
  },
  sectionText: {
    fontSize: '16px',
    lineHeight: '24px',
    color: '#525f7f',
  },
  sectionLink: {
    fontSize: '16px',
    textDecoration: 'underline',
  },
  button: {
    backgroundColor: whitelabelConfig.primaryColor,
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: 'bold',
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'inline-block',
    padding: '12px 24px',
    margin: '20px 0',
  },
  footer: {
    borderTop: '1px solid #e6ebf1',
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '16px',
    textAlign: 'center' as const,
    marginTop: '12px',
    marginBottom: '24px',
  },
}

export const WorkspaceInvitationEmail = ({
  workspaceName,
  inviteUrl,
  inviterName,
  inviterEmail,
}: WorkspaceInvitationEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          You've been invited to join the "{workspaceName}" workspace on {whitelabelConfig.appName}!
        </Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={`${baseUrl}/static/sim.png`}
                  width='114'
                  alt={whitelabelConfig.appName}
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

          <Section style={baseStyles.section}>
            <Heading style={{ fontSize: '24px', fontWeight: 'bold', textAlign: 'center' }}>
              You're invited to join the "{workspaceName}" workspace
            </Heading>
            <Text style={baseStyles.sectionText}>
              Hi there,
            </Text>
            <Text style={baseStyles.sectionText}>
              {inviterName || inviterEmail} has invited you to join the "{workspaceName}" workspace on {whitelabelConfig.appName}.
            </Text>
            <Text style={baseStyles.sectionText}>
              {whitelabelConfig.appName} is a powerful platform for building and deploying AI agents using a visual canvas interface.
            </Text>
            <Text style={baseStyles.sectionText}>
              Click the button below to accept the invitation and get started:
            </Text>
            <Section style={{ textAlign: 'center' }}>
              <Link href={inviteUrl} style={baseStyles.button}>
                Accept Invitation
              </Link>
            </Section>
            <Text style={baseStyles.sectionText}>
              If the button doesn't work, you can copy and paste this link into your browser:
            </Text>
            <Text style={baseStyles.sectionText}>
              <Link href={inviteUrl} style={baseStyles.sectionLink}>
                {inviteUrl}
              </Link>
            </Text>
          </Section>

          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>

          <Section style={baseStyles.section}>
            <Text style={baseStyles.sectionText}>
              Thanks,<br />
              The {whitelabelConfig.appName} Team
            </Text>
          </Section>

          <Section style={baseStyles.footer}>
            <Text>
              © 2024 {whitelabelConfig.companyName}. All rights reserved.
            </Text>
            <Text>
              <Link href={whitelabelConfig.appUrl} style={baseStyles.sectionLink}>
                {whitelabelConfig.appUrl}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default WorkspaceInvitationEmail
