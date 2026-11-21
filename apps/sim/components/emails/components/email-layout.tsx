import { Body, Container, Font, Head, Html, Img, Preview, Section } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailFooter } from '@/components/emails/components/email-footer'
import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * Display box for `public/brand/color/email/wordmark.png`, a raster export of the
 * brand outlines since email clients strip inline SVG. Both dimensions are pinned
 * because email clients do no responsive image selection.
 *
 * The PNG's 272x164 canvas is frozen: sent mail refetches that URL forever with
 * the size it was sent with, so re-export onto the same canvas. This box is safe
 * to retune on its own; the canvas is 6x it, so the mark stays crisp.
 */
const WORDMARK_SIZE = { width: '43', height: '26' } as const

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
  const baseUrl = getBaseUrl()

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
        <Container style={baseStyles.container}>
          <Section style={baseStyles.header}>
            <Img
              src={`${baseUrl}/brand/color/email/wordmark.png`}
              alt='Sim'
              {...WORDMARK_SIZE}
              style={{ display: 'block' }}
            />
          </Section>

          <Section style={baseStyles.content}>{children}</Section>
        </Container>

        {!hideFooter && <EmailFooter baseUrl={baseUrl} showUnsubscribe={showUnsubscribe} />}
      </Body>
    </Html>
  )
}

export default EmailLayout
