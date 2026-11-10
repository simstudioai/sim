import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import type { CredentialGroupsData } from '@/platform/lib/data/models/connected-accounts'
import {
  credentialGroupCatalog,
  credentialTypeCatalog,
} from '@/platform/lib/integrations/metadata.generated'
export function credentialGroupsData(scenario: Scenario): CredentialGroupsData {
  return {
    setup: scenario !== 'empty',
    canManage: true,
    catalog: [...credentialGroupCatalog],
    configured:
      scenario === 'empty'
        ? []
        : ['oauth:gmail', 'oauth:google-calendar', 'oauth:slack', 'mcp:fireflies'],
    credentialTypes: [...credentialTypeCatalog],
    slackTeams:
      scenario === 'empty'
        ? []
        : scenario === 'stress'
          ? ['Customer operations', 'Engineering', 'Product']
          : ['Sim Enterprise'],
    workspaces: [
      { id: 'operations', name: 'Workspace' },
      { id: 'revenue', name: 'Revenue operations' },
      { id: 'research', name: 'Research' },
    ],
    grants:
      scenario === 'empty'
        ? []
        : [
            { workspaceId: 'operations', types: 'all' },
            { workspaceId: 'research', types: ['oauth:gmail'] },
          ],
    people:
      scenario === 'empty'
        ? []
        : [
            {
              id: 'emir',
              email: 'emir@example.com',
              revoked: false,
              accounts: ['Gmail', 'Fireflies'],
            },
            { id: 'jo', email: 'jo@example.test', revoked: false, accounts: [] },
            ...(scenario === 'stress'
              ? Array.from({ length: 64 }, (_, i) => ({
                  id: `operations-member-${i + 1}`,
                  email: `operations.member.${i + 1}@example.test`,
                  revoked: false,
                  accounts: [],
                }))
              : []),
          ],
  }
}
