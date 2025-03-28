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

interface WaitlistConfirmationEmailProps {
  email?: string
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
const calendlyLink = 'https://calendly.com/emir-simstudio/15min'

export const WaitlistConfirmationEmail = ({ email = '' }: WaitlistConfirmationEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Welcome to the Sim Studio Waitlist!</Preview>
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
            <Text style={baseStyles.paragraph}>Welcome to the Sim Studio Waitlist!</Text>
            <Text style={baseStyles.paragraph}>
              Thank you for your interest in Sim Studio. We've added your email ({email}) to our
              waitlist and will notify you as soon as you're granted access.
            </Text>
            <Text style={baseStyles.paragraph}>
              <strong>Want to get access sooner?</strong> Tell us about your use case! Schedule a
              15-minute call with our team to discuss how you plan to use Sim Studio.
            </Text>
            <Link href={calendlyLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Schedule a Call</Text>
            </Link>
            <Text style={baseStyles.paragraph}>
              We're excited to help you build, test, and optimize your agentic workflows.
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
            If you have any questions, please contact us at support@simstudio.ai
          </Text>
        </Section>
      </Body>
    </Html>
  )
}

export default WaitlistConfirmationEmail
