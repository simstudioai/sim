import { Container, Img, Link, Section } from '@react-email/components'
import { baseStyles, colors, spacing, typography } from '@/components/emails/_styles'
import { isHosted } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface EmailFooterProps {
  baseUrl?: string
  messageId?: string
  /**
   * Whether to show unsubscribe link. Defaults to true.
   * Set to false for transactional emails where unsubscribe doesn't apply.
   */
  showUnsubscribe?: boolean
}

/**
 * Email footer component styled to match Stripe's email design.
 * Sits in the gray area below the main white card.
 *
 * For non-transactional emails, the unsubscribe link uses placeholders
 * {{UNSUBSCRIBE_TOKEN}} and {{UNSUBSCRIBE_EMAIL}} which are replaced
 * by the mailer when sending.
 */
export function EmailFooter({
  baseUrl = getBaseUrl(),
  messageId,
  showUnsubscribe = true,
}: EmailFooterProps) {
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
                        <Link href={`${baseUrl}/x`} rel='noopener noreferrer'>
                          <Img
                            src={`${baseUrl}/static/x-icon.png`}
                            width='20'
                            height='20'
                            alt='X'
                          />
                        </Link>
                      </td>
                      <td align='left' style={{ padding: '0 8px' }}>
                        <Link href={`${baseUrl}/discord`} rel='noopener noreferrer'>
                          <Img
                            src={`${baseUrl}/static/discord-icon.png`}
                            width='20'
                            height='20'
                            alt='Discord'
                          />
                        </Link>
                      </td>
                      <td align='left' style={{ padding: '0 8px' }}>
                        <Link href={`${baseUrl}/github`} rel='noopener noreferrer'>
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
                </a>
                {showUnsubscribe && (
                  <>
                    {' '}
                    •{' '}
                    <a
                      href={`${baseUrl}/unsubscribe?token={{UNSUBSCRIBE_TOKEN}}&email={{UNSUBSCRIBE_EMAIL}}`}
                      style={footerLinkStyle}
                      rel='noopener noreferrer'
                    >
                      Unsubscribe
                    </a>
                  </>
                )}
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
