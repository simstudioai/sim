import { Text } from '@react-email/components'
import { format } from 'date-fns'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface CareersConfirmationEmailProps {
  name: string
  position: string
  submittedDate?: Date
}

export function CareersConfirmationEmail({
  name,
  position,
  submittedDate = new Date(),
}: CareersConfirmationEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <EmailLayout
      preview={`Your application to ${brand.name} has been received`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello {name},</Text>
      <Text style={baseStyles.paragraph}>
        We've received your application for <strong>{position}</strong>. Our team reviews every
        application and will reach out if there's a match.
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
    </EmailLayout>
  )
}

export default CareersConfirmationEmail
