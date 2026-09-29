'use client'

import { useCallback, useOptimistic, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Settings sidebar navigation whose clicked row shows as selected until the route settles.
 *
 * Section routes have no loading boundary (see the workspace section layout), so a navigation
 * keeps the outgoing section on screen until the incoming one is ready. Moving the selection on
 * click keeps the click acknowledged while the route resolves.
 *
 * The selection is optimistic state set inside the navigation's own transition, so React drops it
 * the moment that transition settles — on commit, and equally when the server redirects back to
 * the current section or the navigation fails. It never outlives the navigation that set it.
 */
export function usePendingSettingsSelection<TSection extends string>(
  routeSection: TSection
): { activeSection: TSection; navigateToSection: (section: TSection, href: string) => void } {
  const router = useRouter()
  const [activeSection, setOptimisticSection] = useOptimistic(routeSection)
  const [, startTransition] = useTransition()

  const navigateToSection = useCallback(
    (section: TSection, href: string) => {
      startTransition(() => {
        setOptimisticSection(section)
        router.replace(href, { scroll: false })
      })
    },
    [router, setOptimisticSection]
  )

  return { activeSection, navigateToSection }
}
