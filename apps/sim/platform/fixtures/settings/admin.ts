import 'server-only'
import type { AdminExample } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/model'
import type { Scenario } from '@/platform/fixtures'
import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import { settingsScenarios } from '@/platform/fixtures/settings-data'
import type { DirectoryUser } from '@/platform/lib/data/admin-model'

export function adminExample(scenario: Scenario): AdminExample {
  const users: DirectoryUser[] = settingsScenarios[scenario].members.map((member, index) => ({
    ...member,
    role: index <= 1 ? 'admin' : 'user',
    banned: index === 3,
    emailVerified: true,
  }))
  const workspaces = settingsWorkspaces.map((workspace) => workspace.id)
  return {
    superUserModeEnabled: scenario !== 'empty',
    mothershipEnvironment: 'default',
    operatorId: users[0].id,
    users,
    recent: users.slice(1, 4).map((user) => user.id),
    workspaces,
    workflows:
      scenario === 'empty'
        ? []
        : [{ id: '5af987a8-c4ca-4d2a-9ba9-a28892abdd4e', workspaceId: workspaces[0], chats: 2 }],
  }
}
