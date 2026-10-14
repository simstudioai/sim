'use client'

import type { ReactNode } from 'react'
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@sim/emcn'
import { ArrowLeft, ArrowRight } from '@sim/emcn/icons'
import { EnvironmentName } from '@/app/o/[organizationId]/p/components/environments/environment-name'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'
import { useChangelogReleases } from '@/hooks/queries/changelog'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflowTests } from '@/hooks/queries/workflow-tests'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

interface EnvironmentDetailsProps {
  environment: EnvironmentColumn
  parent?: EnvironmentColumn
  forkCount: number
  /** Present when the viewer can sync this fork with its parent. */
  onSync?: (direction: ForkDirection) => void
  /** For the root: the forks that can pull from it, each running that fork's pull. */
  pullInto?: { id: string; label: string; onSelect: () => void }[]
  /** Everything else the viewer can do to the environment, behind the row menu. */
  actions: RowAction[]
  renaming: boolean
  onRenamingChange: (renaming: boolean) => void
  onOpenChangelog: () => void
}

/** What one environment holds, with push and pull to its parent as the only direct actions. */
export function EnvironmentDetails({
  environment,
  parent,
  forkCount,
  onSync,
  pullInto = [],
  actions,
  renaming,
  onRenamingChange,
  onOpenChangelog,
}: EnvironmentDetailsProps) {
  const workspaceId = environment.id
  const testsEnabled = useFeatureFlag('workflow-tests')
  const changelogEnabled = useFeatureFlag('changelog')
  const workflows = useWorkflows(workspaceId)
  const tables = useTablesList(workspaceId, 'active')
  const files = useWorkspaceFiles(workspaceId, 'active')
  const knowledgeBases = useKnowledgeBasesQuery(workspaceId)
  const tests = useWorkflowTests(workspaceId, { enabled: testsEnabled })
  const releases = useChangelogReleases(changelogEnabled ? workspaceId : '')

  const deployedCount = workflows.data?.filter((workflow) => workflow.isDeployed).length ?? 0
  const passingCount = tests.data?.filter((test) => test.status === 'passing').length ?? 0
  const resourceCount =
    (tables.data?.length ?? 0) + (files.data?.length ?? 0) + (knowledgeBases.data?.length ?? 0)
  const latestRelease = releases.data?.pages[0]?.releases[0]

  return (
    <div className='flex flex-col gap-4 px-6 py-5'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <EnvironmentName
            key={environment.id}
            workspaceId={environment.id}
            name={environment.name}
            renaming={renaming}
            onRenamingChange={onRenamingChange}
          />
          <span className='text-[var(--text-muted)] text-caption'>
            {parent ? `Forked from ${parent.label}` : 'Root environment'}
            {forkCount > 0 ? ` · ${forkCount} ${forkCount === 1 ? 'fork' : 'forks'}` : ''}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {onSync ? (
            <>
              <Chip leftIcon={ArrowLeft} onClick={() => onSync('pull')}>
                Pull
              </Chip>
              <Chip variant='primary' leftIcon={ArrowRight} onClick={() => onSync('push')}>
                Push
              </Chip>
            </>
          ) : pullInto.length === 1 ? (
            <Chip variant='primary' leftIcon={ArrowLeft} onClick={pullInto[0].onSelect}>
              Pull into {pullInto[0].label}
            </Chip>
          ) : pullInto.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Chip variant='primary' leftIcon={ArrowLeft}>
                  Pull
                </Chip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {pullInto.map((source) => (
                  <DropdownMenuItem key={source.id} onSelect={source.onSelect}>
                    Into {source.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {actions.length > 0 ? (
            <RowActionsMenu label={`${environment.label} actions`} actions={actions} />
          ) : null}
        </div>
      </div>
      <dl className='grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4'>
        <Stat label='Workflows' loading={workflows.isPending || workflows.isPlaceholderData}>
          {workflows.data?.length ?? 0}
          <span className='text-[var(--text-muted)]'> · {deployedCount} deployed</span>
        </Stat>
        {testsEnabled ? (
          <Stat label='Tests' loading={tests.isPending}>
            {tests.data?.length ? `${passingCount}/${tests.data.length} passing` : 'None'}
          </Stat>
        ) : null}
        <Stat
          label='Resources'
          loading={
            tables.isPending ||
            files.isPending ||
            files.isPlaceholderData ||
            knowledgeBases.isPending
          }
        >
          {resourceCount}
        </Stat>
        {changelogEnabled ? (
          <Stat label='Latest release' loading={releases.isPending}>
            {latestRelease ? (
              <button
                type='button'
                onClick={onOpenChangelog}
                className='min-w-0 truncate text-left transition-colors hover-hover:text-[var(--text-primary)]'
              >
                {latestRelease.version}
              </button>
            ) : (
              'None'
            )}
          </Stat>
        ) : null}
      </dl>
    </div>
  )
}

interface StatProps {
  label: string
  loading: boolean
  children: ReactNode
}

function Stat({ label, loading, children }: StatProps) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <dt className='text-[var(--text-muted)] text-caption'>{label}</dt>
      <dd className='min-w-0 truncate text-[var(--text-body)] text-small'>
        {loading ? <Skeleton className='h-[18px] w-[48px]' /> : children}
      </dd>
    </div>
  )
}
