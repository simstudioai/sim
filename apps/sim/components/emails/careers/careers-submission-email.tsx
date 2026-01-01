import { Body, Container, Head, Html, Img, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { baseStyles, colors } from '@/components/emails/base-styles'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface CareersSubmissionEmailProps {
  name: string
  email: string
  phone?: string
  position: string
  linkedin?: string
  portfolio?: string
  experience: string
  location: string
  message: string
  submittedDate?: Date
}

const getExperienceLabel = (experience: string) => {
  const labels: Record<string, string> = {
    '0-1': '0-1 years',
    '1-3': '1-3 years',
    '3-5': '3-5 years',
    '5-10': '5-10 years',
    '10+': '10+ years',
  }
  return labels[experience] || experience
}

export const CareersSubmissionEmail = ({
  name,
  email,
  phone,
  position,
  linkedin,
  portfolio,
  experience,
  location,
  message,
  submittedDate = new Date(),
}: CareersSubmissionEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>New Career Application from {name}</Preview>

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
            <Text
              style={{
                ...baseStyles.paragraph,
                fontSize: '18px',
                fontWeight: 'bold',
                color: colors.textPrimary,
              }}
            >
              New Career Application
            </Text>

            <Text style={baseStyles.paragraph}>
              A new career application has been submitted on{' '}
              {format(submittedDate, 'MMMM do, yyyy')} at {format(submittedDate, 'h:mm a')}.
            </Text>

            {/* Applicant Information */}
            <Section
              style={{
                marginTop: '24px',
                marginBottom: '24px',
                padding: '20px',
                backgroundColor: colors.bgOuter,
                borderRadius: '8px',
                border: `1px solid ${colors.divider}`,
              }}
            >
              <Text
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: colors.textPrimary,
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                Applicant Information
              </Text>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: colors.textMuted,
                        width: '40%',
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Name:
                    </td>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: colors.textPrimary,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      {name}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: colors.textMuted,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Email:
                    </td>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: colors.textPrimary,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      <a href={`mailto:${email}`} style={baseStyles.link}>
                        {email}
                      </a>
                    </td>
                  </tr>
                  {phone && (
                    <tr>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: colors.textMuted,
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        Phone:
                      </td>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          color: colors.textPrimary,
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        <a href={`tel:${phone}`} style={baseStyles.link}>
                          {phone}
                        </a>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: colors.textMuted,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Position:
                    </td>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: colors.textPrimary,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      {position}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: colors.textMuted,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Experience:
                    </td>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: colors.textPrimary,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      {getExperienceLabel(experience)}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: colors.textMuted,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Location:
                    </td>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        color: colors.textPrimary,
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      {location}
                    </td>
                  </tr>
                  {linkedin && (
                    <tr>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: colors.textMuted,
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        LinkedIn:
                      </td>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          color: colors.textPrimary,
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        <a
                          href={linkedin}
                          target='_blank'
                          rel='noopener noreferrer'
                          style={baseStyles.link}
                        >
                          View Profile
                        </a>
                      </td>
                    </tr>
                  )}
                  {portfolio && (
                    <tr>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: colors.textMuted,
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        Portfolio:
                      </td>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          color: colors.textPrimary,
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        <a
                          href={portfolio}
                          target='_blank'
                          rel='noopener noreferrer'
                          style={baseStyles.link}
                        >
                          View Portfolio
                        </a>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>

            {/* Message */}
            <Section
              style={{
                marginTop: '24px',
                marginBottom: '24px',
                padding: '20px',
                backgroundColor: colors.bgOuter,
                borderRadius: '8px',
                border: `1px solid ${colors.divider}`,
              }}
            >
              <Text
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: colors.textPrimary,
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                About Themselves
              </Text>
              <Text
                style={{
                  margin: '0',
                  fontSize: '14px',
                  color: colors.textPrimary,
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                {message}
              </Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default CareersSubmissionEmail
