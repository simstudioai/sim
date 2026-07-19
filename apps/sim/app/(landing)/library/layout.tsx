import type { ReactNode } from 'react'

/**
 * Library route segment. The shared landing layout owns the chrome (navbar,
 * footer, site-wide JSON-LD, scroll port); this layout only provides the
 * `<main>` landmark for every library page. Library pages emit their own
 * page-specific JSON-LD.
 */
export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <main id='main-content'>{children}</main>
}
