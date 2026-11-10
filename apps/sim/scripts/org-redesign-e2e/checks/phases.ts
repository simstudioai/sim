import { blastRadiusChecks } from '@/scripts/org-redesign-e2e/checks/blast-radius'
import { chatChecks } from '@/scripts/org-redesign-e2e/checks/chat'
import { firstPaintChecks } from '@/scripts/org-redesign-e2e/checks/first-paint'
import { homeChecks } from '@/scripts/org-redesign-e2e/checks/home'
import { integrationChecks } from '@/scripts/org-redesign-e2e/checks/integrations'
import { landingChecks } from '@/scripts/org-redesign-e2e/checks/landing'
import { linksChecks } from '@/scripts/org-redesign-e2e/checks/links'
import { peoplePhaseChecks } from '@/scripts/org-redesign-e2e/checks/people'
import { stateScreenshots } from '@/scripts/org-redesign-e2e/checks/screenshots'
import { searchChecks } from '@/scripts/org-redesign-e2e/checks/search'
import { settingsChecks } from '@/scripts/org-redesign-e2e/checks/settings'
import { sidebarChecks } from '@/scripts/org-redesign-e2e/checks/sidebar'
import { walkRoutes } from '@/scripts/org-redesign-e2e/checks/walk'
import { ADMIN, CONNECTED, MEMBER, NARROW, OWNER } from '@/scripts/org-redesign-e2e/fixture'

/** What each phase runs, in order: `main` against the app as configured, `people` with People on. */
export const PHASES: Record<string, readonly (() => Promise<void>)[]> = {
  main: [
    landingChecks,
    sidebarChecks,
    homeChecks,
    chatChecks,
    searchChecks,
    integrationChecks,
    linksChecks,
    settingsChecks,
    firstPaintChecks,
    blastRadiusChecks,
    () => walkRoutes([MEMBER, ADMIN, OWNER, CONNECTED, NARROW]),
    stateScreenshots,
  ],
  people: [peoplePhaseChecks],
}
