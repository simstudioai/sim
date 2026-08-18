import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getEmailDomain } from '@/lib/core/utils/urls'

const logger = createLogger('SmtpEhloName')

/**
 * A dotted FQDN built from RFC 1035 labels, or an RFC 5321 address literal such
 * as `[203.0.113.5]`. A single dotless label is deliberately rejected: strict
 * relays treat it the same way they treat the loopback literal this module
 * exists to avoid.
 */
const EHLO_NAME_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+|\[[0-9A-Fa-f:.]{1,45}\])$/

function isValidEhloName(value: string): boolean {
  return value.length <= 255 && EHLO_NAME_PATTERN.test(value)
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

  const appDomain = getEmailDomain()
  return isValidEhloName(appDomain) ? appDomain : undefined
}
