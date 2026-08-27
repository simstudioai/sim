import { ProsePage } from '@/app/(landing)/components/prose-page'
import { COOKIE_POLICY_CONFIG } from '@/app/(landing)/cookie-policy/cookie-policy-content'

/**
 * Cookie Policy page - a thin consumer of the shared {@link ProsePage}
 * primitive, alongside Terms and Privacy. The whole document is one typed
 * config ({@link COOKIE_POLICY_CONFIG}) rendered inside the shared route-group
 * layout chrome, so the three legal pages share a layout and cannot drift.
 */
export default function CookiePolicy() {
  return <ProsePage config={COOKIE_POLICY_CONFIG} />
}
