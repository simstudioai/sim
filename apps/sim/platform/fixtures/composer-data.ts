import 'server-only'
import type {
  ChatAttachment,
  ComposerInventory,
  ComposerReference,
} from '@/app/(product)/_components/composer/model'
import type { ShellWorkspace } from '@/app/(product)/_components/model'
import type { CredentialGroupsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import type { Scenario } from '@/platform/fixtures'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'

interface SkillExample {
  id: string
  name: string
  description: string
  /** Built-in skills belong to no workspace. */
  builtIn?: boolean
}

const SKILLS: SkillExample[] = [
  {
    id: 'weekly-review',
    name: 'weekly-review',
    description: 'Prepare the weekly operations review from completed work and open issues.',
  },
  {
    id: 'handoff',
    name: 'customer-handoff',
    description: 'Turn account notes into a handoff for the next owner.',
  },
  {
    id: 'builtin-deploy-workflow',
    name: 'deploy-workflow',
    description: 'Prepare a finished workflow for deployment.',
    builtIn: true,
  },
]

/** The skills the composer's slash offers; the stress scenario adds a long run of similar names. */
export function composerSkills(scenario: Scenario): SkillExample[] {
  if (scenario === 'empty') return []
  if (scenario !== 'stress') return SKILLS
  return [
    ...SKILLS,
    ...Array.from({ length: 28 }, (_, index) => ({
      id: `review-${index}`,
      name: `international-onboarding-review-${index + 1}`,
      description:
        'Prepare a cross-functional customer onboarding review with the regional operations team.',
    })),
  ]
}

export function composerInventory({
  workspaces,
  providers,
  skills,
  credentials,
  desktopPage,
  threads,
  files,
}: {
  workspaces: readonly ShellWorkspace[]
  providers: readonly Pick<IntegrationCatalogEntry, 'id' | 'name' | 'description'>[]
  skills: readonly SkillExample[]
  credentials: CredentialGroupsData
  desktopPage?: string
  threads: readonly { id: string; title: string }[]
  files: readonly ChatAttachment[]
}): ComposerInventory {
  const workspace = workspaces[0]
  if (!workspace) return { references: [], skills: [], tools: [] }
  const owner = { workspaceId: workspace.id, workspaceName: workspace.name }
  const owned = (items: ComposerReference[]) => items.map((item) => ({ ...item, ...owner }))

  return {
    references: [
      { group: 'Workspaces', items: workspaces.map(({ id, name }) => ({ id, name })) },
      {
        group: 'Integrations',
        items: providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          providerId: provider.id,
          detail: provider.description,
        })),
      },
      { group: 'Chats', items: owned(threads.map(({ id, title }) => ({ id, name: title }))) },
      { group: 'Dashboards', items: owned([{ id: 'activity', name: 'Workspace activity' }]) },
      {
        group: 'Tables',
        items: owned([{ id: 'requests', name: 'Customer requests', parentId: 'account-tables' }]),
      },
      {
        group: 'Files',
        items: owned(
          files
            .filter((file) => file.kind !== 'text')
            .map((file) => ({
              id: file.id,
              name: file.name,
              parentId: file.kind === 'document' ? 'account-briefs' : undefined,
            }))
        ),
      },
      {
        group: 'File Folders',
        items: owned([
          { id: 'account-briefs', name: 'Account briefs', folderFor: 'Files' },
          {
            id: 'prior-briefs',
            name: 'Previous reviews',
            folderFor: 'Files',
            parentId: 'account-briefs',
          },
        ]),
      },
      {
        group: 'Knowledge Bases',
        items: owned([{ id: 'onboarding', name: 'Onboarding guide', parentId: 'team-guides' }]),
      },
      {
        group: 'Workflows',
        items: workspaces.flatMap(({ id, name, workflows }) =>
          (workflows ?? []).map((workflow) => ({
            id: `${id}:${workflow.id}`,
            name: workflow.name,
            workspaceId: id,
            workspaceName: name,
            parentId: workflow.folder ? `${id}:${workflow.folder}` : undefined,
          }))
        ),
      },
      {
        group: 'Logs',
        items: owned([{ id: 'last-run', name: 'Account review · Oct 13, 11:24 AM' }]),
      },
      {
        group: 'Folders',
        items: [
          ...owned([
            { id: 'account-tables', name: 'Account tables', folderFor: 'Tables' },
            { id: 'team-guides', name: 'Team guides', folderFor: 'Knowledge Bases' },
          ]),
          ...workspaces.flatMap(({ id, name, workflows }) =>
            Array.from(new Set(workflows?.flatMap((item) => item.folder ?? [])), (folder) => ({
              id: `${id}:${folder}`,
              name: folder,
              folderFor: 'Workflows',
              workspaceId: id,
              workspaceName: name,
            }))
          ),
        ],
      },
    ],
    skills: [
      ...skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        detail: skill.description,
        ...(skill.builtIn ? {} : owner),
      })),
      ...credentials.catalog
        .filter((entry) => entry.method === 'mcp' && credentials.configured.includes(entry.key))
        .map((entry) => ({
          id: entry.key,
          name: entry.name,
          providerId: entry.provider,
          skillKind: 'mcp' as const,
        })),
    ],
    tools: desktopPage
      ? [
          { id: 'browser', label: desktopPage },
          { id: 'terminal', label: 'customer-operations' },
        ]
      : [],
  }
}
