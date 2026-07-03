import { Body, Container, Font, Head, Html, Img, Preview, Section } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailFooter } from '@/components/emails/components/email-footer'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface EmailLayoutProps {
  /** Preview text shown in email client list view */
  preview: string
  /** Email content to render inside the layout */
  children: React.ReactNode
  /** Optional: hide footer for internal emails */
  hideFooter?: boolean
  /**
   * Whether to show unsubscribe link in footer.
   * Set to false for transactional emails where unsubscribe doesn't apply.
   */
  showUnsubscribe: boolean
}

/**
 * Shared email layout wrapper providing consistent structure.
 * Includes Html, Head, Body, Container with logo header, and Footer.
 */
export function EmailLayout({
  preview,
  children,
  hideFooter = false,
  showUnsubscribe,
}: EmailLayoutProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const hasCustomLogo = Boolean(brand.logoUrl)

  return (
    <Html>
      <Head>
        <Font
          fontFamily='Season Sans'
          fallbackFontFamily={['Helvetica', 'sans-serif']}
          webFont={{
            url: `${baseUrl}/brand/fonts/SeasonSansUprightsVF.woff2`,
            format: 'woff2',
          }}
          fontWeight='300 800'
          fontStyle='normal'
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={baseStyles.main}>
        {/* Main card container */}
        <Container style={baseStyles.container}>
          {/* Header with logo */}
          <Section style={baseStyles.header}>
            <Img
              src={brand.logoUrl || `${baseUrl}/brand/color/email/wordmark.png`}
              height='34'
              {...(hasCustomLogo ? {} : { width: '70' })}
              alt={brand.name}
              style={hasCustomLogo ? { display: 'block', width: 'auto' } : { display: 'block' }}
            />
          </Section>

          {/* Content */}
          <Section style={baseStyles.content}>{children}</Section>
        </Container>

        {/* Footer in gray section */}
        {!hideFooter && <EmailFooter baseUrl={baseUrl} showUnsubscribe={showUnsubscribe} />}
      </Body>
    </Html>
  )
}

export default EmailLayout
