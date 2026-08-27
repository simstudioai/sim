import { isIPv4, isIPv6 } from 'node:net'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getEmailDomain } from '@/lib/core/utils/urls'

const logger = createLogger('SmtpEhloName')

/**
 * A dotted FQDN built from RFC 1035 labels. A single dotless label is
 * deliberately rejected: strict relays treat it the same way they treat the
 * loopback literal this module exists to avoid.
 */
const FQDN_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** RFC 5321 §4.1.3 tags the IPv6 form, case-insensitively per RFC 5234 §2.3. */
const IPV6_TAG_PATTERN = /^IPv6:/i

/**
 * An RFC 5321 §4.1.3 address literal — `[192.0.2.1]` or `[IPv6:2001:db8::1]`.
 * The address itself is parsed rather than pattern-matched, so a bracketed
 * value that merely looks like one (`[::::]`, `[13]`) is refused here instead
 * of at the relay.
 */
function isAddressLiteral(value: string): boolean {
  if (!value.startsWith('[') || !value.endsWith(']')) return false
  const inner = value.slice(1, -1)
  return IPV6_TAG_PATTERN.test(inner) ? isIPv6(inner.slice(5)) : isIPv4(inner)
}

function isValidEhloName(value: string): boolean {
  return value.length <= 255 && (FQDN_PATTERN.test(value) || isAddressLiteral(value))
}

/**
 * Drops a trailing `:port`, leaving an IPv6 literal such as `[::1]` intact.
 * `getEmailDomain` reports a URL's `host`, so a deployment served on a
 * non-default port would otherwise carry one into the greeting, where it is
 * not a legal domain.
 */
function stripPort(host: string): string {
  const lastColon = host.lastIndexOf(':')
  return lastColon === -1 || host.indexOf(']') > lastColon ? host : host.slice(0, lastColon)
}

let warnedInvalidName = false

/**
 * Resolves the hostname to send in the SMTP `EHLO` greeting, or `undefined` to
 * leave nodemailer's own default in place.
 *
 * Nodemailer derives its default from `os.hostname()` and substitutes the
 * address literal `[127.0.0.1]` whenever that name contains no dot. Kubernetes
 * pod hostnames never contain one, so on every k8s deployment Sim introduces
 * itself to the relay as loopback. Strict relays read that as a misconfigured
 * client and refuse the session before any mail moves — Google Workspace's
 * `smtp-relay.gmail.com` answers `421-4.7.0 Try again later, closing
 * connection`, which surfaces as "All email providers failed" on invitations
 * and verification mail.
 *
 * RFC 5321 §4.1.4 asks the client to greet with its own fully-qualified domain
 * name, so the deployment's own domain is the correct answer when the host
 * cannot supply one. `SMTP_EHLO_NAME` overrides it for relays that expect a
 * different identity than the app is served from.
 */
export function getSmtpEhloName(): string | undefined {
  const configured = env.SMTP_EHLO_NAME?.trim()
  if (configured) {
    if (isValidEhloName(configured)) return configured
    if (!warnedInvalidName) {
      warnedInvalidName = true
      logger.warn(
        'SMTP_EHLO_NAME is not a fully-qualified domain name or address literal; ignoring it. Set it to a dotted hostname such as mail.yourdomain.com.'
      )
    }
  }

  const appDomain = stripPort(getEmailDomain())
  return isValidEhloName(appDomain) ? appDomain : undefined
}
