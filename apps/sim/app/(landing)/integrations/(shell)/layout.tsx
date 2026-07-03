import type { ReactNode } from 'react'

/**
 * Integrations route segment. The shared landing layout owns the chrome (navbar,
 * footer, site-wide JSON-LD, scroll port); this layout only provides the
 * `<main>` landmark. Pages emit their own page-specific JSON-LD.
 */
export default function IntegrationsLayout({ children }: { children: ReactNode }) {
  return <main id='main-content'>{children}</main>
}
