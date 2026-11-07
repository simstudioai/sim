/**
 * @vitest-environment node
 *
 * Failure mode: a workspace member sent to the organization surface, which lists only Search
 * connections, loses the workspace credential gallery. Only an organization on the Platform has an
 * integration center that replaces it.
 */
import { describe, expect, it } from 'vitest'
import { workspaceIntegrationsPath } from '@/lib/navigation/paths'

const WORKSPACE = '/workspace/ws-1/integrations'

describe('where a workspace’s Integrations lead', () => {
  it.each([
    ['a standalone workspace', { hostOrganizationId: null, features: {} }],
    [
      'a standalone workspace, even with stale organization features',
      { hostOrganizationId: null, features: { organizationSearch: true, platformOrgUi: true } },
    ],
    [
      'an organization with member Search but not on the Platform',
      { hostOrganizationId: 'org-1', features: { organizationSearch: true, platformOrgUi: false } },
    ],
    [
      'an app version that predates the Platform field',
      { hostOrganizationId: 'org-1', features: { organizationSearch: true } },
    ],
    [
      'a Platform organization the viewer cannot search in',
      { hostOrganizationId: 'org-1', features: { organizationSearch: false, platformOrgUi: true } },
    ],
    ['an unresolved host context', null],
  ])('stay in the workspace for %s', (_name, context) => {
    expect(workspaceIntegrationsPath('ws-1', context)).toBe(WORKSPACE)
  })

  it('lead a member of a Platform organization to its integration center', () => {
    expect(
      workspaceIntegrationsPath('ws-1', {
        hostOrganizationId: 'org-1',
        features: { organizationSearch: true, platformOrgUi: true },
      })
    ).toBe('/o/org-1/integrations')
  })
})
