import {
  LegalBlockGroup,
  LegalSectionView,
  ProseHero,
  ProseShell,
} from '@/app/(landing)/components/prose-page/components'
import type { LegalPageConfig } from '@/app/(landing)/components/prose-page/types'

/**
 * The reusable legal-page content stack - the single component both Terms and
 * Privacy consume. A legal route renders the shared {@link LandingShell} and
 * drops in one `<ProsePage config={…} />`, so the two documents share one hero,
 * one full-width left-aligned column, one rhythm, and one set of block
 * treatments - they cannot drift from each other.
 *
 * Order is fixed: hero (the page's only `<h1>`, carrying the title, the
 * "Last updated" meta, and the lead) → an optional intro block group under the
 * `<h1>` → the configured legal sections in array order. The heading outline is
 * strict H1 → H2 (per section) → H3 (per subheading block), never skipped.
 * Server Component - the whole page is static.
 */

interface ProsePageProps {
  /** The complete legal-page content - hero copy, intro, and ordered sections. */
  config: LegalPageConfig
}

export function ProsePage({ config }: ProsePageProps) {
  return (
    <ProseShell>
      <ProseHero
        title={config.title}
        meta={`Last updated: ${config.lastUpdated}`}
        lead={config.description}
      />

      {config.intro.length > 0 ? <LegalBlockGroup blocks={config.intro} /> : null}

      {config.sections.map((section) => (
        <LegalSectionView key={section.id} section={section} />
      ))}
    </ProseShell>
  )
}
