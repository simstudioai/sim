import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import { season } from '@/app/_styles/fonts/season/season'

/**
 * Landing page route-group layout.
 *
 * Applies landing-specific font CSS variables to the subtree:
 * - `--font-season` (Season Sans): Headings and display text
 * - `--font-martian-mono` (Martian Mono): Code snippets and technical accents
 *
 * Available to child components via Tailwind (`font-season`, `font-martian-mono`).
 *
 * SEO metadata for the `/` route is exported from `app/page.tsx` — not here.
 * This layout only applies when a `page.tsx` exists inside the `(home)/` route group.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${season.variable} ${martianMono.variable}`}>{children}</div>
}
