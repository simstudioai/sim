import type {
  OrganizationSectionAccess,
  OrganizationSettingsFeatures,
  OrganizationSettingsSection,
} from '@/components/settings/navigation'

export function organizationMemberSectionAccess(
  section: OrganizationSettingsSection,
  isAdmin: boolean
): OrganizationSectionAccess {
  if (section === 'search-mcp' || section === 'recently-deleted' || section === 'knowledge-graphs')
    return 'view'
  if (section === 'members' || section === 'requests') return isAdmin ? 'manage' : 'view'
  return isAdmin ? 'manage' : 'unavailable'
}

/**
 * Applies deployment and target-organization plan gates without consulting the
 * viewer's active organization.
 */
/**
 * What a personal organization offers: its owner's plan and usage and their own content. No
 * members to invite or govern, and no team or Enterprise configuration.
 */
const PERSONAL_ORGANIZATION_SECTIONS: ReadonlySet<OrganizationSettingsSection> = new Set([
  'billing',
  'usage',
  'recently-deleted',
  'knowledge-graphs',
  'search-mcp',
])

export function organizationPlanAllowsSettingsSection(
  section: OrganizationSettingsSection,
  features: OrganizationSettingsFeatures
): boolean {
  if (features.personal) {
    if (!PERSONAL_ORGANIZATION_SECTIONS.has(section)) return false
    if (section === 'billing') return features.billingEnabled
    if (section === 'usage') return features.hosted || (features.selfHosted.usage ?? false)
    return true
  }
  if (
    section === 'members' ||
    section === 'search-mcp' ||
    section === 'knowledge-graphs' ||
    section === 'recently-deleted' ||
    section === 'requests'
  )
    return true
  if (section === 'billing') return features.billingEnabled
  /* Sim Search itself is enterprise on the hosted product; self-hosted gates it by flag, not by section. */
  if (section === 'integrations' || section === 'search-slack')
    return !features.hosted || features.hasEnterprisePlan
  /**
   * Access Control follows governance rather than the plan gate: its restrictions keep applying
   * through a failing payment, so hiding the page that edits them would leave an organization
   * governed by rules it cannot see or loosen until the invoice clears.
   */
  if (section === 'access-control' && features.hosted) return features.governanceActive
  if (features.hosted) return features.hasEnterprisePlan
  return features.selfHosted[section] ?? false
}

/** Additional feature rollouts can hide an otherwise entitled section from the organization sidebar. */
export function organizationSupportsSettingsSection(
  section: OrganizationSettingsSection,
  features: OrganizationSettingsFeatures,
  availability: { connectedAccounts: boolean; search: boolean; knowledgeGraphs?: boolean },
  isAdmin: boolean
): boolean {
  return (
    organizationMemberSectionAccess(section, isAdmin) !== 'unavailable' &&
    (section !== 'knowledge-graphs' || availability.knowledgeGraphs === true) &&
    (section !== 'connected-accounts' || availability.connectedAccounts) &&
    ((section !== 'search-mcp' && section !== 'search-slack' && section !== 'integrations') ||
      availability.search) &&
    organizationPlanAllowsSettingsSection(section, features)
  )
}
