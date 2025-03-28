import * as React from 'react'
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
import { baseStyles } from './base-styles'

interface WaitlistApprovalEmailProps {
  email?: string
  signupLink: string
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

export const WaitlistApprovalEmail = ({ email = '', signupLink }: WaitlistApprovalEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>You've been approved to join Sim Studio!</Preview>
        <Container style={baseStyles.container}>
          <Section
            style={{
              ...baseStyles.header,
              textAlign: 'center',
              padding: '30px',
            }}
          >
            <Img
              src={`${baseUrl}/sim.png`}
              width="114"
              alt="Sim Studio"
              style={{
                display: 'inline-block',
                margin: '0 auto',
              }}
            />
          </Section>
          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>
          <Section style={baseStyles.content}>
            <Text style={baseStyles.paragraph}>Good news! You're off the waitlist!</Text>
            <Text style={baseStyles.paragraph}>
              We're excited to let you know that you've been approved to join Sim Studio. You can
              now create an account and start building your agentic workflows.
            </Text>
            <Link
              href={`${signupLink}&email=${encodeURIComponent(email)}`}
              style={{ textDecoration: 'none' }}
            >
              <Text style={baseStyles.button}>Create Your Account</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              This special access link is valid for 7 days. If you have any questions or need
              assistance getting started, don't hesitate to reach out to our support team.
            </Text>
            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Studio Team
            </Text>
          </Section>
        </Container>

        <Section style={baseStyles.footer}>
          <Row>
            <Column align="right" style={{ width: '50%', paddingRight: '8px' }}>
              <Link href="https://x.com/simstudioai" style={{ textDecoration: 'none' }}>
                <Img
                  src={`${baseUrl}/x-icon.png`}
                  width="20"
                  height="20"
                  alt="X"
                  style={{
                    display: 'block',
                    marginLeft: 'auto',
                    filter: 'grayscale(100%)',
                    opacity: 0.7,
                  }}
                />
              </Link>
            </Column>
            <Column align="left" style={{ width: '50%', paddingLeft: '8px' }}>
              <Link href="https://discord.gg/crdsGfGk" style={{ textDecoration: 'none' }}>
                <Img
                  src={`${baseUrl}/discord-icon.png`}
                  width="24"
                  height="24"
                  alt="Discord"
                  style={{
                    display: 'block',
                    filter: 'grayscale(100%)',
                    opacity: 0.9,
                  }}
                />
              </Link>
            </Column>
          </Row>
          <Text
            style={{
              ...baseStyles.footerText,
              textAlign: 'center',
              color: '#706a7b',
            }}
          >
            © {new Date().getFullYear()} Sim Studio, All Rights Reserved
            <br />
            If you have any questions, please contact us at help@simstudio.ai
          </Text>
        </Section>
      </Body>
    </Html>
  )
}

export default WaitlistApprovalEmail
