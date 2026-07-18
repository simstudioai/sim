'use client'

import { useMemo, useState } from 'react'
import { Button, ChipInput, Label, Loader } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { isValidAppSlug } from '@/lib/apps/reserved-slugs'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useAppProjects, useCreateAppProject } from '@/hooks/queries/apps'

export default function WorkspaceAppsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const router = useRouter()
  const searchParams = useSearchParams()
  const createdFromChatId = searchParams.get('chatId')
  const permissions = useUserPermissionsContext()
  const { canEdit } = permissions
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectsQuery = useAppProjects(workspaceId, { enabled: canEdit === true })
  const createProject = useCreateAppProject()
  const projects = projectsQuery.data?.projects ?? []
  const slugValid = useMemo(() => isValidAppSlug(slug), [slug])

  const slugify = (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)

  async function createApp() {
    setError(null)
    try {
      const result = await createProject.mutateAsync({
        workspaceId,
        name: name.trim(),
        slug,
        ...(createdFromChatId ? { createdFromChatId } : {}),
      })
      router.push(`/workspace/${workspaceId}/apps/${result.project.id}`)
    } catch (createError) {
      setError(getErrorMessage(createError, 'Failed to create app'))
    }
  }

  if (permissions.isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loader className='size-5' />
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className='p-8 text-[var(--text-secondary)] text-sm'>
        Workspace write permission is required to access Apps.
      </div>
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10'>
      <header className='space-y-1'>
        <h1 className='font-semibold text-2xl text-[var(--text-primary)] tracking-tight'>Apps</h1>
        <p className='text-[var(--text-secondary)] text-sm'>
          {createdFromChatId
            ? 'Create an app linked to this Full-stack chat.'
            : 'Full-stack mode binds existing deployed workflows to a published React frontend.'}
        </p>
      </header>

      <section className='rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4'>
        <div className='mb-4 flex items-center gap-2'>
          <Plus className='size-[14px] text-[var(--text-icon)]' />
          <h2 className='font-medium text-[var(--text-primary)] text-sm'>Create an app</h2>
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='app-name'>Name</Label>
            <ChipInput
              id='app-name'
              placeholder='TikTok profile viewer'
              value={name}
              onChange={(event) => {
                const nextName = event.target.value
                setName(nextName)
                if (!slugTouched) setSlug(slugify(nextName))
              }}
              disabled={!canEdit || createProject.isPending}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='app-slug'>Slug</Label>
            <ChipInput
              id='app-slug'
              placeholder='tiktok-profile-viewer'
              value={slug}
              onChange={(event) => {
                setSlugTouched(true)
                setSlug(slugify(event.target.value))
              }}
              error={Boolean(slug && !slugValid)}
              disabled={!canEdit || createProject.isPending}
            />
            {slug && !slugValid ? (
              <p className='text-[var(--text-error)] text-xs'>Use a non-reserved lowercase slug.</p>
            ) : null}
          </div>
        </div>
        <div className='mt-4 flex items-center justify-between gap-3'>
          <p className='text-[var(--text-tertiary)] text-xs'>
            Public URLs use a permanent random ID, so changing this slug cannot hijack old links.
          </p>
          <Button
            type='button'
            variant='tertiary'
            onClick={() => void createApp()}
            disabled={!canEdit || !name.trim() || !slugValid || createProject.isPending}
          >
            {createProject.isPending ? 'Creating…' : 'Create app'}
          </Button>
        </div>
        {!canEdit ? (
          <p className='mt-2 text-[var(--text-tertiary)] text-xs'>
            Workspace write permission is required to create an app.
          </p>
        ) : null}
        {error ? <p className='text-red-500 text-sm'>{error}</p> : null}
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='font-medium text-[var(--text-secondary)] text-sm'>Your apps</h2>
        {projectsQuery.isLoading ? (
          <div className='flex h-24 items-center justify-center'>
            <Loader className='size-5' />
          </div>
        ) : null}
        {projectsQuery.isError ? (
          <p className='text-[var(--text-error)] text-sm'>
            {getErrorMessage(projectsQuery.error, 'Failed to load apps')}
          </p>
        ) : null}
        {!projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 ? (
          <div className='rounded-lg border border-[var(--border)] border-dashed px-4 py-10 text-center'>
            <p className='text-[var(--text-secondary)] text-sm'>
              Create your first app to bind a deployed workflow and publish a frontend.
            </p>
          </div>
        ) : null}
        <ul className='grid gap-2'>
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type='button'
                className='flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-left hover:bg-[var(--surface-2)]'
                onClick={() => router.push(`/workspace/${workspaceId}/apps/${p.id}`)}
              >
                <span className='min-w-0'>
                  <span className='block truncate font-medium text-[var(--text-primary)]'>
                    {p.name}
                  </span>
                  <span className='block truncate text-[var(--text-tertiary)] text-xs'>
                    /a/{p.publicId}/{p.slug}/
                  </span>
                </span>
                <span className='flex shrink-0 items-center gap-3'>
                  <span className='text-[var(--text-tertiary)] text-xs'>
                    {p.publishedReleaseId ? 'Published' : 'Draft'}
                  </span>
                  <ArrowRight className='size-[14px] text-[var(--text-icon)]' />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
