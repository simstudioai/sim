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
            <Text style={{ ...baseStyles.paragraph, fontSize: '18px', fontWeight: 'bold' }}>
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
                backgroundColor: '#f9f9f9',
                borderRadius: '8px',
                border: '1px solid #e5e5e5',
              }}
            >
              <Text
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#333333',
                }}
              >
                Applicant Information
              </Text>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tr>
                  <td
                    style={{
                      padding: '8px 0',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#666666',
                      width: '40%',
                    }}
                  >
                    Name:
                  </td>
                  <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>{name}</td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: '8px 0',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#666666',
                    }}
                  >
                    Email:
                  </td>
                  <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
                    <a
                      href={`mailto:${email}`}
                      style={{ color: '#802FFF', textDecoration: 'none' }}
                    >
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
                        color: '#666666',
                      }}
                    >
                      Phone:
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
                      <a href={`tel:${phone}`} style={{ color: '#802FFF', textDecoration: 'none' }}>
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
                      color: '#666666',
                    }}
                  >
                    Position:
                  </td>
                  <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
                    {position}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: '8px 0',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#666666',
                    }}
                  >
                    Experience:
                  </td>
                  <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
                    {getExperienceLabel(experience)}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: '8px 0',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#666666',
                    }}
                  >
                    Location:
                  </td>
                  <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
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
                        color: '#666666',
                      }}
                    >
                      LinkedIn:
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
                      <a
                        href={linkedin}
                        target='_blank'
                        rel='noopener noreferrer'
                        style={{ color: '#802FFF', textDecoration: 'none' }}
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
                        color: '#666666',
                      }}
                    >
                      Portfolio:
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#333333' }}>
                      <a
                        href={portfolio}
                        target='_blank'
                        rel='noopener noreferrer'
                        style={{ color: '#802FFF', textDecoration: 'none' }}
                      >
                        View Portfolio
                      </a>
                    </td>
                  </tr>
                )}
              </table>
            </Section>

            {/* Message */}
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
                About Themselves
              </Text>
              <Text
                style={{
                  margin: '0',
                  fontSize: '14px',
                  color: '#333333',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {message}
              </Text>
            </Section>

            <Text style={baseStyles.paragraph}>
              Please review this application and reach out to the candidate at your earliest
              convenience.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default CareersSubmissionEmail
