import { Body, Container, Font, Head, Html, Img, Preview, Section } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailFooter } from '@/components/emails/components/email-footer'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

/**
 * Wordmark display size. `wordmark.png` is 272×164, so these are exactly 1/4 of
 * its intrinsic size — the asset is a 4x source and must stay that way, since
 * email clients do no responsive image selection. Changing one of these without
 * the other distorts the mark.
 */
const WORDMARK_HEIGHT = 41
const WORDMARK_WIDTH = 68

/** Whitelabeled logos are arbitrary aspect ratios, so only height is pinned. */
const CUSTOM_LOGO_HEIGHT = 34

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
        {/*
          `fallbackFontFamily` only accepts react-email's fixed union, so it
          cannot express the platform's full chain (`system-ui`, `Segoe UI`,
          `Roboto`, …) — this is the closest allowed subset. The complete chain
          lives on `typography.fontFamily`, which is applied inline to every
          element and is what clients that strip `@font-face` actually use.
        */}
        <Font
          fontFamily='Season Sans'
          fallbackFontFamily={['Helvetica', 'Arial', 'sans-serif']}
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
              alt={brand.name}
              {...(hasCustomLogo
                ? { height: `${CUSTOM_LOGO_HEIGHT}` }
                : { height: `${WORDMARK_HEIGHT}`, width: `${WORDMARK_WIDTH}` })}
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
