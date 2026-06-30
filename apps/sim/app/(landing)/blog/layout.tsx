import type { ReactNode } from 'react'

/**
 * Blog route segment. The shared landing layout owns the chrome (navbar, footer,
 * site-wide JSON-LD, scroll port); this layout only provides the `<main>`
 * landmark for every blog page. Blog pages emit their own page-specific JSON-LD.
 */
export default function BlogLayout({ children }: { children: ReactNode }) {
  return <main id='main-content'>{children}</main>
}
