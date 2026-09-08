import { cn } from '@sim/emcn'
import { LANDING_CONTENT_WIDTH } from '@/app/(landing)/components/landing-layout'
import {
  SolutionsCardRow,
  SolutionsHero,
  SolutionsLogosRow,
  SolutionsStructuredData,
} from '@/app/(landing)/components/solutions-page/components'
import { SolutionsProductPage } from '@/app/(landing)/components/solutions-page/components/solutions-product-page'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type {
  SolutionsPageConfig,
  SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page/types'

/**
 * Shared main content for platform and solutions routes. The content column
 * owns its width, gutter, and rhythm; LandingShell supplies the closing CTA
 * and footer. Configs contain only copy and visual slots, keeping every hero,
 * logo row, and feature card row on the same layout.
 */

interface SolutionsPageProps {
  /** The complete page content - identity, hero, and ordered card rows. */
  config: SolutionsPageConfig | SolutionsProductPageConfig
}

export function SolutionsPage({ config }: SolutionsPageProps) {
  if ('features' in config) {
    return <SolutionsProductPage config={config} />
  }

  return (
    <>
      <SolutionsStructuredData config={config} />
      <main id='main-content'>
        <div
          className={cn(
            'flex flex-col',
            LANDING_CONTENT_WIDTH,
            SOLUTIONS_SPACING.sectionRhythm,
            SOLUTIONS_SPACING.gutter
          )}
        >
          <SolutionsHero hero={config.hero} />
          <SolutionsLogosRow />
          {config.rows.map((row) => (
            <SolutionsCardRow key={row.id} row={row} />
          ))}
        </div>
      </main>
    </>
  )
}
