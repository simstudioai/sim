import { LandingShell } from '@/app/(landing)/components'
import { ProsePage } from '@/app/(landing)/components/prose-page'
import { PRIVACY_CONFIG } from '@/app/(landing)/privacy/privacy-content'

/**
 * Privacy Policy page — a thin consumer of the shared {@link ProsePage}
 * primitive. The whole document is one typed config ({@link PRIVACY_CONFIG})
 * rendered inside the shared {@link LandingShell}; it shares its layout, rhythm,
 * and chrome with Terms and cannot drift.
 */
export default function Privacy() {
  return (
    <LandingShell>
      <ProsePage config={PRIVACY_CONFIG} />
    </LandingShell>
  )
}
