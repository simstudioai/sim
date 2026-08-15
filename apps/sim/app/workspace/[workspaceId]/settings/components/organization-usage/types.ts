import type { OrganizationMembersResponse } from '@/lib/api/contracts/organization'

/**
 * One row of the organization's usage roster, exactly as
 * `GET /api/organizations/[id]/members?include=usage` returns it.
 *
 * Derived from the contract rather than restated, so a schema change surfaces
 * here as a type error instead of silently drifting. `currentPeriodCost` and
 * `currentUsageLimit` are **dollars** on the wire — every credit figure this
 * page renders goes through `@/lib/billing/credits/conversion`.
 */
export type MemberUsageRow = OrganizationMembersResponse['data'][number]
