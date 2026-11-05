import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import type { MemberSecretSource } from '@/platform/lib/integrations/member-secret-source'
import { memberSecretMetadata } from '@/platform/lib/integrations/metadata.generated'

export function memberSecretSource(
  scenario: Scenario,
  requestedMode?: string | string[]
): MemberSecretSource | null {
  if (scenario !== 'stress') return null
  return requestedMode === 'organization'
    ? { ...memberSecretMetadata, mode: 'organization' }
    : { ...memberSecretMetadata, mode: 'member', names: ['ANALYTICS_API_KEY', 'REPORTING_TOKEN'] }
}
