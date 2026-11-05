import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import type { MemberSecretSource } from '@/platform/lib/integrations/member-secret-source'

export function memberSecretSource(
  scenario: Scenario,
  requestedMode?: string | string[]
): MemberSecretSource | null {
  if (scenario !== 'stress') return null
  return requestedMode === 'organization'
    ? { mode: 'organization' }
    : { mode: 'member', names: ['ANALYTICS_API_KEY', 'REPORTING_TOKEN'] }
}
