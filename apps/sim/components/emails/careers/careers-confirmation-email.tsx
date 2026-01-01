import { Body, Container, Head, Html, Img, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

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
            <Text style={baseStyles.paragraph}>Hello {name},</Text>
            <Text style={baseStyles.paragraph}>
              We've received your application for <strong>{position}</strong>. Our team reviews
              every application and will reach out if there's a match.
            </Text>

            <Text style={baseStyles.paragraph}>
              In the meantime, explore our{' '}
              <a
                href='https://docs.sim.ai'
                target='_blank'
                rel='noopener noreferrer'
                style={baseStyles.link}
              >
                docs
              </a>{' '}
              or{' '}
              <a href={`${baseUrl}/studio`} style={baseStyles.link}>
                blog
              </a>{' '}
              to learn more about what we're building.
            </Text>

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

export default CareersConfirmationEmail
