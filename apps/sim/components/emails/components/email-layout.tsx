import { Body, Container, Head, Html, Img, Preview, Section } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailFooter } from '@/components/emails/components/email-footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface EmailLayoutProps {
  /** Preview text shown in email client list view */
  preview: string
  /** Email content to render inside the layout */
  children: React.ReactNode
  /** Optional: hide footer for internal emails */
  hideFooter?: boolean
}

/**
 * Shared email layout wrapper providing consistent structure.
 * Includes Html, Head, Body, Container with logo header, and Footer.
 */
export function EmailLayout({ preview, children, hideFooter = false }: EmailLayoutProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={baseStyles.main}>
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
          <Section style={baseStyles.content}>{children}</Section>
        </Container>

        {/* Footer in gray section */}
        {!hideFooter && <EmailFooter baseUrl={baseUrl} />}
      </Body>
    </Html>
  )
}

export default EmailLayout
