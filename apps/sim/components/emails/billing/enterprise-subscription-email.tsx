import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface EnterpriseSubscriptionEmailProps {
  userName?: string
  loginLink?: string
}

export const EnterpriseSubscriptionEmail = ({
  userName = 'Valued User',
  loginLink,
}: EnterpriseSubscriptionEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const effectiveLoginLink = loginLink || `${baseUrl}/login`

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your Enterprise Plan is now active on {brand.name}</Preview>

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
            <Text style={baseStyles.paragraph}>Hello {userName},</Text>
            <Text style={baseStyles.paragraph}>
              Your <strong>Enterprise Plan</strong> is now active. You have full access to advanced
              features and increased capacity for your workflows.
            </Text>

            <Link href={effectiveLoginLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Open {brand.name}</Text>
            </Link>

            <Text style={baseStyles.paragraph}>
              <strong>Next steps:</strong>
              <br />• Invite team members to your organization
              <br />• Start building your workflows
            </Text>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Questions? Reply to this email or contact us at{' '}
              <Link href={`mailto:${brand.supportEmail}`} style={baseStyles.link}>
                {brand.supportEmail}
              </Link>
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default EnterpriseSubscriptionEmail
