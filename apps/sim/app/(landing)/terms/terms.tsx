import { LandingShell } from '@/app/(landing)/components'
import { ProsePage } from '@/app/(landing)/components/prose-page'
import { TERMS_CONFIG } from '@/app/(landing)/terms/terms-content'

/**
 * Terms of Service page — a thin consumer of the shared {@link ProsePage}
 * primitive. The whole document is one typed config ({@link TERMS_CONFIG})
 * rendered inside the shared {@link LandingShell}; this page passes only content,
 * so it shares its layout, rhythm, and chrome with Privacy and cannot drift.
 */
export default function Terms() {
  return (
    <LandingShell>
      <ProsePage config={TERMS_CONFIG} />
    </LandingShell>
  )
}
