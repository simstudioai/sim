import { Container, Img, Link, Section } from 'react-email'
import { baseStyles, colors, spacing } from '@/components/emails/_styles'
import { isHosted } from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

/**
 * Social mark display size. Every `static/*-icon.png` is 40×40, so 20px is a
 * clean 2x source — email clients do no responsive image selection, so the
 * asset must be authored at 2x and pinned here. This is deliberately NOT the
 * platform's 14px UI-icon size: these are brand marks in an image, not
 * `--text-icon` glyphs, and 14px renders them illegibly.
 */
const SOCIAL_ICON_SIZE = 20

/**
 * `display: block` removes the 2–3px gap Outlook adds under inline images;
 * `border: 0` prevents the blue link border older Outlook draws around a linked
 * image.
 */
const socialIconStyle = { display: 'block' as const, border: 0 }

/** Trailing gap only, so the row starts flush with the gutter. */
const SOCIAL_CELL_STYLE = { paddingRight: 16 } as const

const SOCIAL_LINKS = [
  { path: 'x', label: 'X', icon: 'x-icon.png' },
  { path: 'linkedin', label: 'LinkedIn', icon: 'linkedin-icon.png' },
  { path: 'github', label: 'GitHub', icon: 'github-icon.png' },
  { path: 'slack', label: 'Slack', icon: 'slack-icon.png' },
] as const

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
  const isWhitelabeled = brand.isWhitelabeled

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

            {/* Social links row — hidden for whitelabeled instances */}
            {!isWhitelabeled && (
              <>
                <tr>
                  <td style={baseStyles.gutter} width={spacing.gutter}>
                    &nbsp;
                  </td>
                  <td>
                    <table cellPadding={0} cellSpacing={0} style={{ border: 0 }}>
                      <tbody>
                        <tr>
                          {SOCIAL_LINKS.map(({ path, label, icon }) => (
                            <td key={path} align='left' style={SOCIAL_CELL_STYLE}>
                              <Link href={`${baseUrl}/${path}`} rel='noopener noreferrer'>
                                <Img
                                  src={`${baseUrl}/static/${icon}`}
                                  width={SOCIAL_ICON_SIZE}
                                  height={SOCIAL_ICON_SIZE}
                                  alt={label}
                                  style={socialIconStyle}
                                />
                              </Link>
                            </td>
                          ))}
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
              </>
            )}

            {/* Address row — hidden for whitelabeled instances */}
            {!isWhitelabeled && (
              <>
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
              </>
            )}

            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                Questions?{' '}
                {/*
                  A raw anchor, not `<Link>`: react-email's Link hardcodes
                  target="_blank", which on a mailto: opens a blank tab beside
                  the compose window in most webmail clients.
                */}
                <a href={`mailto:${brand.supportEmail}`} style={baseStyles.footerLink}>
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

            <tr>
              <td style={baseStyles.gutter} width={spacing.gutter}>
                &nbsp;
              </td>
              <td style={baseStyles.footerText}>
                <Link
                  href={`${baseUrl}/privacy`}
                  style={baseStyles.footerLink}
                  rel='noopener noreferrer'
                >
                  Privacy Policy
                </Link>{' '}
                •{' '}
                <Link
                  href={`${baseUrl}/terms`}
                  style={baseStyles.footerLink}
                  rel='noopener noreferrer'
                >
                  Terms of Service
                </Link>
                {showUnsubscribe && (
                  <>
                    {' '}
                    •{' '}
                    <Link
                      href={`${baseUrl}/unsubscribe?token={{UNSUBSCRIBE_TOKEN}}&email={{UNSUBSCRIBE_EMAIL}}`}
                      style={baseStyles.footerLink}
                      rel='noopener noreferrer'
                    >
                      Unsubscribe
                    </Link>
                  </>
                )}
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
