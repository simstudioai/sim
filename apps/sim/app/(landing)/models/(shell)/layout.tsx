import type { ReactNode } from 'react'

/**
 * Models route segment. The shared landing layout owns the chrome (navbar,
 * footer, site-wide JSON-LD, scroll port); this layout only provides the
 * `<main>` landmark. Pages emit their own page-specific JSON-LD.
 */
export default function ModelsLayout({ children }: { children: ReactNode }) {
  return <main id='main-content'>{children}</main>
}
