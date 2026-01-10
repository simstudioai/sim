import { Container, Img, Link, Section } from '@react-email/components'
import { baseStyles, colors, spacing, typography } from '@/components/emails/_styles'
import { getBrandConfig } from '@/lib/branding/branding'
import { isHosted } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface UnsubscribeOptions {
  unsubscribeToken?: string
  email?: string
}

interface EmailFooterProps {
  baseUrl?: string
  unsubscribe?: UnsubscribeOptions
  messageId?: string
}

/**
 * Email footer component styled to match Stripe's email design.
 * Sits in the gray area below the main white card.
 */
export function EmailFooter({ baseUrl = getBaseUrl(), unsubscribe, messageId }: EmailFooterProps) {
  const brand = getBrandConfig()

  const footerLinkStyle = {
    color: colors.textMuted,
    textDecoration: 'underline',
    fontWeight: 'normal' as const,
    fontFamily: typography.fontFamily,
  }

  return (
    <Section
      style={{
        backgroundColor: colors.footerBg,
        width: '100%',
      }}
    >
      <Container style={{ maxWidth: `${spacing.containerWidth}px`, margin: '0 auto' }}>
        <table
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width='100%'
          style={{ minWidth: `${spacing.containerWidth}px` }}
        >
          <tbody>
            <tr>
              <td style={baseStyles.spacer} height={32}>
                &nbsp;
              </td>
            </tr>

            {/* Social links row */}
            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td>
                <table cellPadding={0} cellSpacing={0} style={{ border: 0 }}>
                  <tbody>
                    <tr>
                      <td align='left' style={{ padding: '0 8px 0 0' }}>
                        <Link href='https://x.com/simdotai' rel='noopener noreferrer'>
                          <Img
                            src={`${baseUrl}/static/x-icon.png`}
                            width='20'
                            height='20'
                            alt='X'
                          />
                        </Link>
                      </td>
                      <td align='left' style={{ padding: '0 8px' }}>
                        <Link href='https://discord.gg/Hr4UWYEcTT' rel='noopener noreferrer'>
                          <Img
                            src={`${baseUrl}/static/discord-icon.png`}
                            width='20'
                            height='20'
                            alt='Discord'
                          />
                        </Link>
                      </td>
                      <td align='left' style={{ padding: '0 8px' }}>
                        <Link href='https://github.com/simstudioai/sim' rel='noopener noreferrer'>
                          <Img
                            src={`${baseUrl}/static/github-icon.png`}
                            width='20'
                            height='20'
                            alt='GitHub'
                          />
                        </Link>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={16}>
                &nbsp;
              </td>
            </tr>

            {/* Address row */}
            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                {brand.name}
                {isHosted && <>, 80 Langton St, San Francisco, CA 94103, USA</>}
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={8}>
                &nbsp;
              </td>
            </tr>

            {/* Contact row */}
            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                Questions?{' '}
                <a href={`mailto:${brand.supportEmail}`} style={footerLinkStyle}>
                  {brand.supportEmail}
                </a>
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={8}>
                &nbsp;
              </td>
            </tr>

            {/* Message ID row (optional) */}
            {messageId && (
              <>
                <tr>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                  <td style={baseStyles.footerText}>
                    Need to refer to this message? Use this ID: {messageId}
                  </td>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                </tr>
                <tr>
                  <td style={baseStyles.spacer} height={8}>
                    &nbsp;
                  </td>
                </tr>
              </>
            )}

            {/* Links row */}
            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                <a href={`${baseUrl}/privacy`} style={footerLinkStyle} rel='noopener noreferrer'>
                  Privacy Policy
                </a>{' '}
                •{' '}
                <a href={`${baseUrl}/terms`} style={footerLinkStyle} rel='noopener noreferrer'>
                  Terms of Service
                </a>{' '}
                •{' '}
                <a
                  href={
                    unsubscribe?.unsubscribeToken && unsubscribe?.email
                      ? `${baseUrl}/unsubscribe?token=${unsubscribe.unsubscribeToken}&email=${encodeURIComponent(unsubscribe.email)}`
                      : `mailto:${brand.supportEmail}?subject=Unsubscribe%20Request&body=Please%20unsubscribe%20me%20from%20all%20emails.`
                  }
                  style={footerLinkStyle}
                  rel='noopener noreferrer'
                >
                  Unsubscribe
                </a>
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            {/* Copyright row */}
            <tr>
              <td style={baseStyles.spacer} height={16}>
                &nbsp;
              </td>
            </tr>
            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                © {new Date().getFullYear()} {brand.name}, All Rights Reserved
              </td>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
            </tr>

            <tr>
              <td style={baseStyles.spacer} height={32}>
                &nbsp;
              </td>
            </tr>
          </tbody>
        </table>
      </Container>
    </Section>
  )
}

export default EmailFooter
