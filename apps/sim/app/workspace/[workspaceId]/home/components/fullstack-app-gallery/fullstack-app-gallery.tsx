'use client'

import { useMemo, useState } from 'react'
import { Button, cn } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { ImageIcon, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { AppProjectListItem } from '@/lib/api/contracts/apps'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useAppProjects } from '@/hooks/queries/apps'

export type AppGalleryProject = AppProjectListItem

const STATUS_LABELS: Record<AppGalleryProject['interfaceStatus'], string> = {
  ready: 'Ready',
  building: 'Building',
  failed: 'Build failed',
  empty: 'Not started',
}

const STATUS_STYLES: Record<AppGalleryProject['interfaceStatus'], string> = {
  ready: 'bg-emerald-500',
  building: 'bg-amber-500',
  failed: 'bg-[var(--text-error)]',
  empty: 'bg-[var(--text-muted)]',
}

export function normalizeAppSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim()
}

export function filterAppProjects(
  projects: AppGalleryProject[],
  search: string
): AppGalleryProject[] {
  const normalizedSearch = normalizeAppSearch(search)
  if (!normalizedSearch) return projects

  return projects.filter((project) =>
    normalizeAppSearch(`${project.name} ${project.slug}`).includes(normalizedSearch)
  )
}

export function getAppProjectHref(workspaceId: string, project: AppGalleryProject): string {
  const builderChatId = project.lastBuilderChatId || project.createdFromChatId
  return builderChatId
    ? `/workspace/${workspaceId}/chat/${builderChatId}`
    : `/workspace/${workspaceId}/apps/${project.id}`
}

function AppThumbnail({ project }: { project: AppGalleryProject }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(project.thumbnailUrl) && !imageFailed

  return (
    <div className='relative aspect-video overflow-hidden bg-[var(--surface-2)]'>
      {!imageLoaded || !showImage ? (
        <div
          className='absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,var(--surface-3),var(--surface-2))]'
          aria-hidden='true'
        >
          <ImageIcon className='size-6 text-[var(--text-muted)]' />
        </div>
      ) : null}
      {showImage ? (
        <img
          src={project.thumbnailUrl!}
          alt={`${project.name} preview`}
          loading='lazy'
          decoding='async'
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-200',
            imageLoaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageFailed(true)
            setImageLoaded(false)
          }}
        />
      ) : null}
    </div>
  )
}

function AppCard({
  project,
  workspaceId,
  onOpen,
}: {
  project: AppGalleryProject
  workspaceId: string
  onOpen: (href: string) => void
}) {
  return (
    <li>
      <button
        type='button'
        className='group hover:-translate-y-0.5 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)] text-left transition-[border-color,transform,box-shadow] hover:border-[var(--border-strong)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]'
        onClick={() => onOpen(getAppProjectHref(workspaceId, project))}
      >
        <AppThumbnail project={project} />
        <span className='flex items-center justify-between gap-3 border-[var(--border)] border-t px-3 py-2.5'>
          <span className='min-w-0'>
            <span className='block truncate font-medium text-[var(--text-primary)] text-sm'>
              {project.name}
            </span>
            <span className='block truncate text-[var(--text-tertiary)] text-xs'>
              {project.slug}
            </span>
          </span>
          <span className='flex shrink-0 items-center gap-1.5 text-[var(--text-tertiary)] text-xs'>
            <span
              className={cn('size-1.5 rounded-full', STATUS_STYLES[project.interfaceStatus])}
              aria-hidden='true'
            />
            {STATUS_LABELS[project.interfaceStatus]}
          </span>
        </span>
      </button>
    </li>
  )
}

export function FullstackAppGallery({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const permissions = useUserPermissionsContext()
  const [search, setSearch] = useState('')
  const projectsQuery = useAppProjects(workspaceId, {
    enabled: permissions.canEdit === true,
  })
  const projects = projectsQuery.data?.projects ?? []
  const filteredProjects = useMemo(() => filterAppProjects(projects, search), [projects, search])

  if (permissions.isLoading) {
    return (
      <div className='flex min-h-32 items-center justify-center' aria-label='Loading apps'>
        <Loader animate className='size-5' />
      </div>
    )
  }

  if (!permissions.canEdit) {
    return (
      <div className='rounded-xl border border-[var(--border)] border-dashed px-4 py-8 text-center text-[var(--text-secondary)] text-sm'>
        Workspace write permission is required to access Apps.
      </div>
    )
  }

  if (projectsQuery.isLoading) {
    return (
      <div className='flex min-h-32 items-center justify-center' aria-label='Loading apps'>
        <Loader animate className='size-5' />
      </div>
    )
  }

  if (projectsQuery.isError) {
    return (
      <div
        className='flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border)] border-dashed px-4 py-8 text-center'
        role='alert'
      >
        <p className='text-[var(--text-error)] text-sm'>
          {getErrorMessage(projectsQuery.error, 'Failed to load apps')}
        </p>
        <Button type='button' variant='default' onClick={() => void projectsQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className='rounded-xl border border-[var(--border)] border-dashed px-4 py-10 text-center'>
        <p className='font-medium text-[var(--text-secondary)] text-sm'>No apps yet</p>
        <p className='mt-1 text-[var(--text-tertiary)] text-xs'>
          Describe an app above to create your first one.
        </p>
      </div>
    )
  }

  return (
    <section className='flex flex-col gap-4' aria-labelledby='fullstack-apps-heading'>
      <div className='flex flex-col items-start gap-3'>
        <h2
          id='fullstack-apps-heading'
          className='font-medium text-[var(--text-secondary)] text-sm'
        >
          Your apps
        </h2>
        <label className='relative block w-full sm:w-64'>
          <span className='sr-only'>Search apps</span>
          <Search
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-3.5 text-[var(--text-muted)]'
            aria-hidden='true'
          />
          <input
            type='search'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Search apps'
            className='h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] pr-3 pl-9 text-[var(--text-primary)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]'
          />
        </label>
      </div>

      {filteredProjects.length === 0 ? (
        <div className='rounded-xl border border-[var(--border)] border-dashed px-4 py-10 text-center text-[var(--text-secondary)] text-sm'>
          No apps match “{search.trim()}”.
        </div>
      ) : (
        <ul className='grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]'>
          {filteredProjects.map((project) => (
            <AppCard
              key={project.id}
              project={project}
              workspaceId={workspaceId}
              onOpen={router.push}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
