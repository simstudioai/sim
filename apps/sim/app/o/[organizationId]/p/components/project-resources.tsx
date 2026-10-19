'use client'

import { lazy, Suspense, useCallback, useState } from 'react'
import { Skeleton, toast } from '@sim/emcn'
import {
  Database,
  Files as FilesIcon,
  Integration,
  Library,
  ShieldCheck,
  Table,
  Workflow,
} from '@sim/emcn/icons'
import { parseAsString, useQueryState, useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { INTEGRATIONS } from '@/lib/integrations'
import { sendMothershipMessage } from '@/lib/mothership/events'
import {
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import {
  Resource,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  ResourceNavigationProvider,
  runResourceFromHref,
} from '@/app/workspace/[workspaceId]/components/resource/resource-navigation'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { connectParam } from '@/app/workspace/[workspaceId]/integrations/[block]/search-params'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import {
  PermissionAccessBoundary,
  useWorkspaceAccessRequestFeatures,
} from '@/ee/access-requests/components/permission-access-boundary'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const Workflows = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/components/workflows-list/workflows-list').then((m) => ({
    default: m.WorkflowsList,
  }))
)
const Files = lazy(() =>
  import('@/app/workspace/[workspaceId]/files/files').then((m) => ({ default: m.Files }))
)
const Tables = lazy(() =>
  import('@/app/workspace/[workspaceId]/tables/tables').then((m) => ({ default: m.Tables }))
)
const Knowledge = lazy(() =>
  import('@/app/workspace/[workspaceId]/knowledge/knowledge').then((m) => ({
    default: m.Knowledge,
  }))
)
const Logs = lazy(() => import('@/app/workspace/[workspaceId]/logs/logs'))
const KnowledgeDocument = lazy(() =>
  import('@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/document').then((m) => ({
    default: m.Document,
  }))
)
const Tests = lazy(() =>
  import('@/app/workspace/[workspaceId]/tests/tests').then((m) => ({ default: m.Tests }))
)
const Integrations = lazy(() =>
  import('@/app/workspace/[workspaceId]/integrations/integrations').then((m) => ({
    default: m.Integrations,
  }))
)
const IntegrationDetail = lazy(() =>
  import('@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail').then(
    (m) => ({ default: m.IntegrationBlockDetail })
  )
)
const Skills = lazy(() =>
  import('@/app/workspace/[workspaceId]/skills/skills').then((m) => ({ default: m.Skills }))
)
const SkillCreate = lazy(() =>
  import('@/app/workspace/[workspaceId]/skills/new/skill-create').then((m) => ({
    default: m.SkillCreate,
  }))
)
const SkillDetail = lazy(() =>
  import('@/app/workspace/[workspaceId]/skills/[skillId]/skill-detail').then((m) => ({
    default: m.SkillDetail,
  }))
)
const CredentialDetail = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/integrations/connected/[credentialId]/connected-credential-detail'
  ).then((m) => ({ default: m.ConnectedCredentialDetail }))
)

const KINDS = [
  {
    id: 'workflows',
    path: 'w',
    type: 'workflow',
    label: 'Workflows',
    icon: Workflow,
    component: Workflows,
  },
  {
    id: 'files',
    path: 'files',
    type: 'file',
    label: 'Files',
    icon: FilesIcon,
    component: Files,
    permission: 'hideFilesTab',
  },
  {
    id: 'tables',
    path: 'tables',
    type: 'table',
    label: 'Tables',
    icon: Table,
    component: Tables,
    permission: 'hideTablesTab',
  },
  {
    id: 'knowledge',
    path: 'knowledge',
    type: 'knowledgebase',
    label: 'Knowledge',
    icon: Database,
    component: Knowledge,
    permission: 'hideKnowledgeBaseTab',
  },
  { id: 'logs', path: 'logs', type: 'log', label: 'Logs', icon: Library, component: Logs },
  { id: 'tests', path: 'tests', type: 'test', label: 'Tests', icon: ShieldCheck, component: Tests },
  {
    id: 'integrations',
    path: 'integrations',
    type: 'integration',
    label: 'Integrations',
    icon: Integration,
    component: Integrations,
    permission: 'hideIntegrationsTab',
  },
] as const
const EXCLUDED: readonly MothershipResourceType[] = [
  'dashboard',
  'sources',
  'search',
  'folder',
  'filefolder',
  'task',
  'integration',
  'generic',
  'browser',
  'terminal',
]
const COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'detail', header: 'Kind' },
]
const KIND_COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'detail', header: 'Items' },
]

interface ProjectResourcesProps {
  project: Project
}

/** Production lists retain their actions while navigation stays beside the chat. */
export function ProjectResources({ project }: ProjectResourcesProps) {
  const [params, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const [, setListLocation] = useQueryStates({ folderId: parseAsString, search: parseAsString })
  const [, setConnect] = useQueryState(connectParam.key, connectParam.parser)
  const { addResource } = useMothershipResources()
  const { config } = usePermissionConfig()
  const [search, setSearch] = useState('')
  const { data: credentials } = useWorkspaceCredentials({ workspaceId: project.id })
  const inventory = useAvailableResources(project.id, { excludeTypes: EXCLUDED })
  const testsEnabled = useFeatureFlag('workflow-tests')
  const accessRequests = useWorkspaceAccessRequestFeatures()
  const accessRequestsEnabled = accessRequests.data?.enabled === true
  /** A hidden kind stays listed where its page offers an access request, as in the rail. */
  const kinds = KINDS.filter(
    (kind) =>
      (!('permission' in kind) || !config[kind.permission] || accessRequestsEnabled) &&
      (kind.id !== 'tests' || testsEnabled)
  )
  const selected = kinds.find((kind) => kind.id === params.resourceKind)
  const select = useCallback(
    (kind: string) => {
      void setListLocation({ folderId: null, search: null })
      void setParams({ resourceKind: kind, resourceDetail: '' })
    },
    [setListLocation, setParams]
  )
  const navigate = useCallback(
    (href: string, replace = false) => {
      const url = new URL(href, window.location.origin)
      const [, scope, workspaceId, path, ...rest] = url.pathname.split('/')
      if (
        url.origin !== window.location.origin ||
        scope !== 'workspace' ||
        workspaceId !== project.id
      ) {
        toast.error('This destination is outside the selected environment.')
        return
      }
      if (path === 'home') {
        const prompt = LandingPromptStorage.consume()
        if (prompt) sendMothershipMessage(prompt, undefined, undefined, undefined, 'agent')
        return
      }
      if (path === 'skills') {
        /** Skills sit under Integrations, as its second tab. */
        void setParams(
          { resourceKind: 'integrations', resourceDetail: ['skills', ...rest].join('/') },
          { history: replace ? 'replace' : 'push' }
        )
        return
      }
      const kind = KINDS.find((candidate) => candidate.path === path)
      const run = kind?.id === 'logs' ? runResourceFromHref(url, project.id) : null
      if (run) {
        addResource(run)
        void setParams({ pane: null })
        return
      }
      if (!kind) {
        void setParams({ resourceKind: '', resourceDetail: '' })
        return
      }
      if (rest[0] && kind.type !== 'integration' && !(kind.id === 'knowledge' && rest[1])) {
        const item = inventory.groups
          .find((group) => group.type === kind.type)
          ?.items.find((item) => item.id === rest[0])
        addResource(
          resourceFromItem(kind.type, {
            ...item,
            id: rest[0],
            name: item?.name ?? kind.label,
            workspaceId: project.id,
          })
        )
        /** Reveal the tab even when it is already the active resource behind the project view. */
        void setParams({ pane: null, ...(kind.id === 'knowledge' ? { resourceDetail: '' } : {}) })
        return
      }
      void setParams(
        { resourceKind: kind.id, resourceDetail: rest.join('/') },
        { history: replace ? 'replace' : 'push' }
      )
      if (kind.id === 'integrations') void setConnect(url.searchParams.get(connectParam.key))
    },
    [project.id, inventory.groups, addResource, setParams, setConnect]
  )
  const needle = search.trim().toLowerCase()
  const matches = inventory.groups.flatMap((group) => {
    const kind = kinds.find((kind) => kind.type === group.type)
    if (!kind) return []
    return group.items
      .filter((item) => item.name.toLowerCase().includes(needle))
      .map((item) => ({
        kind,
        resource: resourceFromItem(group.type, { ...item, workspaceId: project.id }),
      }))
  })
  const rows: ResourceRow[] = needle
    ? matches.map(({ kind, resource }, index) => ({
        id: String(index),
        cells: {
          name: { icon: <kind.icon className='size-[14px]' />, label: resource.title },
          detail: { label: kind.label },
        },
      }))
    : kinds.map((kind) => ({
        id: kind.id,
        cells: {
          name: { icon: <kind.icon className='size-[14px]' />, label: kind.label },
          detail: {
            label:
              kind.id === 'integrations'
                ? String(
                    credentials?.filter(
                      (credential) =>
                        credential.type === 'oauth' ||
                        credential.type === 'service_account' ||
                        credential.type === 'personal_token'
                    ).length ?? '—'
                  )
                : inventory.isHydrating
                  ? '—'
                  : String(
                      inventory.groups.find((group) => group.type === kind.type)?.items.length ?? 0
                    ) +
                    (kind.id === 'logs' &&
                    (inventory.groups.find((group) => group.type === kind.type)?.items.length ??
                      0) >= 50
                      ? '+'
                      : ''),
          },
        },
      }))
  if (!selected)
    return (
      <Resource>
        <Resource.Options
          search={{ value: search, onChange: setSearch, placeholder: `Search ${project.name}` }}
        />
        {needle && inventory.isHydrating ? (
          <Skeleton className='m-6 h-24' />
        ) : needle && !rows.length ? (
          <EmptyState title='No resources found' description='Try another resource name.' />
        ) : (
          <Resource.Table
            columns={needle ? COLUMNS : KIND_COLUMNS}
            rows={rows}
            onRowClick={(id) => (needle ? addResource(matches[Number(id)].resource) : select(id))}
          />
        )}
      </Resource>
    )
  const Component = selected.component
  const integration = INTEGRATIONS.find((item) => item.slug === params.resourceDetail)
  const [knowledgeBaseId, documentId] =
    selected.id === 'knowledge' ? params.resourceDetail.split('/') : []
  return (
    <ResourceNavigationProvider
      navigate={navigate}
      openResource={addResource}
      onDirectory={() => select('')}
    >
      {/* Managed: links stay in the pane, behind the same unsaved-changes prompt as elsewhere. */}
      <div
        data-settings-navigation='managed'
        className='flex h-full min-h-0 flex-col'
        onClickCapture={(event) => {
          const anchor = (event.target as HTMLElement).closest('a')
          const href = anchor?.getAttribute('href')
          if (href?.startsWith(`/workspace/${project.id}/`)) {
            event.preventDefault()
            event.stopPropagation()
            useSettingsDirtyStore.getState().requestLeave(() => navigate(href))
          }
        }}
      >
        {selected.id === 'integrations' && (
          <Resource.Header
            breadcrumbs={[
              { label: 'Resources', onClick: () => select('') },
              { label: 'Integrations', onClick: () => select('integrations') },
            ]}
          />
        )}
        <div className='min-h-0 flex-1 overflow-auto'>
          <Suspense fallback={<Skeleton className='m-6 h-32' />}>
            {selected.id === 'integrations' && params.resourceDetail ? (
              <PermissionAccessBoundary configKey='hideIntegrationsTab'>
                {params.resourceDetail === 'skills' ? (
                  <Skills />
                ) : params.resourceDetail === 'skills/new' ? (
                  <SkillCreate workspaceId={project.id} />
                ) : params.resourceDetail.startsWith('skills/') ? (
                  <SkillDetail
                    workspaceId={project.id}
                    skillId={params.resourceDetail.slice('skills/'.length)}
                  />
                ) : params.resourceDetail.startsWith('connected/') ? (
                  <CredentialDetail
                    workspaceId={project.id}
                    credentialId={params.resourceDetail.slice('connected/'.length)}
                  />
                ) : integration ? (
                  <IntegrationDetail workspaceId={project.id} integration={integration} />
                ) : (
                  <p className='p-6'>Integration unavailable.</p>
                )}
              </PermissionAccessBoundary>
            ) : knowledgeBaseId && documentId ? (
              <PermissionAccessBoundary configKey='hideKnowledgeBaseTab'>
                <KnowledgeDocument knowledgeBaseId={knowledgeBaseId} documentId={documentId} />
              </PermissionAccessBoundary>
            ) : 'permission' in selected ? (
              <PermissionAccessBoundary configKey={selected.permission}>
                <Component />
              </PermissionAccessBoundary>
            ) : (
              <Component />
            )}
          </Suspense>
        </div>
      </div>
    </ResourceNavigationProvider>
  )
}
