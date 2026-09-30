import { MOCK_DASHBOARDS } from '@/app/playground/org/lib/dashboards'
import {
  ISSUES,
  RESOURCES,
  type Workspace,
  workspaceById,
} from '@/app/playground/org/lib/mock-data'
import { WORKSPACE_SECTIONS } from '@/app/playground/org/lib/routes'

/** Resource families the chat panel can browse and open as tabs. */
export type PanelKind =
  | 'dashboard'
  | 'issues'
  | 'workflows'
  | 'files'
  | 'logs'
  | 'tables'
  | 'knowledge'

const PANEL_KIND_IDS: readonly PanelKind[] = [
  'dashboard',
  'issues',
  'workflows',
  'files',
  'logs',
  'tables',
  'knowledge',
]

export function isPanelKind(id: string): id is PanelKind {
  return (PANEL_KIND_IDS as readonly string[]).includes(id)
}

export interface PanelKindConfig {
  id: PanelKind
  label: string
  icon: (typeof WORKSPACE_SECTIONS)[number]['icon']
}

/** Kinds in the order the project chips show them. */
export const PANEL_KINDS: PanelKindConfig[] = WORKSPACE_SECTIONS.flatMap((section) =>
  isPanelKind(section.id) ? [{ id: section.id, label: section.label, icon: section.icon }] : []
)

export function panelKindConfig(kind: PanelKind): PanelKindConfig {
  const config = PANEL_KINDS.find((section) => section.id === kind)
  if (!config) throw new Error(`Unknown panel kind ${kind}`)
  return config
}

export interface PanelResource {
  kind: PanelKind
  id: string
  /** The project it belongs to; chats are not scoped, resources are. */
  workspaceId: string
  name: string
  /** What the chat did with it, or the row's detail. */
  status?: string
}

export function panelResourceKey(resource: PanelResource): string {
  return `${resource.kind}:${resource.id}`
}

const MENTIONED: Record<string, PanelResource[]> = {
  c15: [
    {
      kind: 'knowledge',
      id: 'refund-2024',
      workspaceId: 'support',
      name: 'Refund policy (2024)',
      status: 'Edit proposed',
    },
    {
      kind: 'issues',
      id: 'SUP-153',
      workspaceId: 'support',
      name: 'Knowledge check got two answers to one question',
      status: 'Needs approval',
    },
    {
      kind: 'logs',
      id: 'refund-questions',
      workspaceId: 'support',
      name: 'Refund questions',
      status: '48 runs',
    },
    {
      kind: 'dashboard',
      id: 'support-operations',
      workspaceId: 'support',
      name: 'Support operations',
    },
  ],
  c0: [
    {
      kind: 'issues',
      id: 'INF-412',
      workspaceId: 'infra',
      name: 'Bot replies in untagged threads',
      status: 'Ready',
    },
    {
      kind: 'workflows',
      id: 'w1',
      workspaceId: 'infra',
      name: 'slack-support-bot',
      status: 'v14 deployed',
    },
  ],
}

export function mentionedIn(chatId: string): PanelResource[] {
  return MENTIONED[chatId] ?? []
}

export function resourcesOfKind(workspace: Workspace, kind: PanelKind): PanelResource[] {
  const workspaceId = workspace.id
  switch (kind) {
    case 'dashboard':
      return workspace.dashboards.map((id) => ({
        kind,
        id,
        workspaceId,
        name: MOCK_DASHBOARDS[id].title,
      }))
    case 'issues':
      return ISSUES.filter((issue) => issue.workspaceId === workspaceId).map((issue) => ({
        kind,
        id: issue.key,
        workspaceId,
        name: issue.title,
        status: issue.key,
      }))
    default:
      return RESOURCES[kind].map((item) => ({
        kind,
        id: item.id,
        workspaceId,
        name: item.name,
        status: item.meta,
      }))
  }
}

/** The resource a `kind:workspaceId:id` reference names; throws when it names nothing. */
export function resolvePanelResource(ref: string): PanelResource {
  const [kind, workspaceId, id] = ref.split(':')
  if (!kind || !workspaceId || !id || !isPanelKind(kind)) throw new Error(`Bad resource ref ${ref}`)
  const known = [
    ...Object.values(MENTIONED).flat(),
    ...resourcesOfKind(workspaceById(workspaceId), kind),
  ].find((resource) => resource.kind === kind && resource.id === id)
  if (!known) throw new Error(`Unknown resource ${ref}`)
  return known
}
