import type { Scenario } from '@/platform/fixtures'
import { createGeneralFixture } from '@/platform/fixtures/settings/general'
import { createGraphsFixture } from '@/platform/fixtures/settings/knowledge-graphs'
import type { PreviewPlan } from '@/platform/lib/navigation'

export interface SettingsFixtureProfile {
  id: string
  name: string
  email: string
  image: string | null
}

export interface SettingsFixtureState {
  scenario: Scenario
  plan: PreviewPlan
  organizationId: string
  referenceTime: number
  general: ReturnType<typeof createGeneralFixture>
  knowledgeGraphs: ReturnType<typeof createGraphsFixture>
  records: Map<string, unknown>
}

/** Only retained in the document that mounted the fixture-enabled Settings route. */
export function createSettingsFixture(
  scenario: Scenario,
  plan: PreviewPlan,
  organizationId: string,
  profile: SettingsFixtureProfile,
  referenceTime: number
): SettingsFixtureState {
  return {
    scenario,
    plan,
    organizationId,
    referenceTime,
    general: createGeneralFixture(profile),
    knowledgeGraphs: createGraphsFixture(scenario),
    records: new Map(),
  }
}
