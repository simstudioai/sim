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
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

interface CareersConfirmationEmailProps {
  name: string
  position: string
  submittedDate?: Date
}

export const CareersConfirmationEmail = ({
  name,
  position,
  submittedDate = new Date(),
}: CareersConfirmationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your application to {brand.name} has been received</Preview>
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
            <Text style={baseStyles.paragraph}>Hello {name},</Text>
            <Text style={baseStyles.paragraph}>
              Thank you for your interest in joining the {brand.name} team! We've received your
              application for the <strong>{position}</strong> position.
            </Text>

            <Text style={baseStyles.paragraph}>
              Our team carefully reviews every application and will get back to you within the next
              few weeks. If your qualifications match what we're looking for, we'll reach out to
              schedule an initial conversation.
            </Text>

            <Section
              style={{
                marginTop: '24px',
                marginBottom: '24px',
                padding: '20px',
                backgroundColor: '#f9f9f9',
                borderRadius: '8px',
                border: '1px solid #e5e5e5',
              }}
            >
              <Text
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#333333',
                }}
              >
                What Happens Next?
              </Text>
              <ul
                style={{
                  margin: '0',
                  padding: '0 0 0 20px',
                  fontSize: '14px',
                  color: '#333333',
                  lineHeight: '1.8',
                }}
              >
                <li>Our team will review your application</li>
                <li>If you're a good fit, we'll reach out to schedule an interview</li>
                <li>We'll keep you updated throughout the process</li>
              </ul>
            </Section>

            <Text style={baseStyles.paragraph}>
              In the meantime, feel free to explore our{' '}
              <a
                href='https://docs.sim.ai'
                target='_blank'
                rel='noopener noreferrer'
                style={{ color: '#802FFF', textDecoration: 'none' }}
              >
                documentation
              </a>{' '}
              to learn more about what we're building, or check out our{' '}
              <a href={`${baseUrl}/blog`} style={{ color: '#802FFF', textDecoration: 'none' }}>
                blog
              </a>{' '}
              for the latest updates.
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
              This confirmation was sent on {format(submittedDate, 'MMMM do, yyyy')} at{' '}
              {format(submittedDate, 'h:mm a')}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default CareersConfirmationEmail
