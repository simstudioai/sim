'use client'

import { useMemo, useState } from 'react'
import { Badge, Button, ChipInput } from '@sim/emcn'
import type { OrgResourceApi, OrgServiceApi } from '@/lib/api/contracts/api-reference'
import { ResourceTestPanel } from '@/app/workspace/[workspaceId]/org-resources/components/resource-test-panel'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useOrgResources } from '@/hooks/queries/org-resources'

/** One exposed resource, rendered with the essentials a caller needs to invoke it. */
function ResourceCard({ resource }: { resource: OrgResourceApi }) {
  const inputFields = Object.keys(resource.input.properties ?? {})
  const outputFields = Object.keys(resource.output.properties ?? {})
  const latest = resource.versions[0]
  const [testing, setTesting] = useState(false)

  return (
    <div className='rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='truncate font-medium text-[var(--text-primary)] text-base'>
              {resource.name}
            </span>
            <Badge variant='type' size='sm'>
              {resource.resourceType}
            </Badge>
            {resource.version != null && (
              <Badge variant='type' size='sm'>
                v{resource.version}
              </Badge>
            )}
          </div>
          {resource.summary && (
            <p className='mt-1 text-[var(--text-secondary)] text-small'>{resource.summary}</p>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <Badge variant='type' size='sm'>
            {resource.auth.type === 'public' ? 'public' : 'api key'}
          </Badge>
          {resource.exposure.trace === 'traceId' && (
            <Badge variant='type' size='sm'>
              trace
            </Badge>
          )}
          {resource.exposure.blocks && (
            <Badge variant='type' size='sm'>
              blocks
            </Badge>
          )}
        </div>
      </div>

      <div className='mt-3 flex flex-col gap-2 text-caption'>
        <div className='flex items-center gap-2'>
          <span className='shrink-0 text-[var(--text-tertiary)]'>POST</span>
          <code className='truncate rounded bg-[var(--surface-4)] px-1.5 py-0.5 text-[var(--text-secondary)]'>
            {resource.invokeUrl}
          </code>
        </div>
        {inputFields.length > 0 && (
          <div className='text-[var(--text-secondary)]'>
            <span className='text-[var(--text-tertiary)]'>Input: </span>
            {inputFields.join(', ')}
          </div>
        )}
        {outputFields.length > 0 && (
          <div className='text-[var(--text-secondary)]'>
            <span className='text-[var(--text-tertiary)]'>Output: </span>
            {outputFields.join(', ')}
          </div>
        )}
        {latest?.breaking && (
          <div className='text-[var(--text-warning,orange)]'>
            Latest deploy is a breaking change: {latest.changes.join('; ')}
          </div>
        )}
      </div>

      <div className='mt-3'>
        <Button variant='default' onClick={() => setTesting((t) => !t)}>
          {testing ? 'Hide test' : 'Test API'}
        </Button>
      </div>
      {testing && <ResourceTestPanel resource={resource} />}
    </div>
  )
}

/** A service (workspace) section with its exposed resources. */
function ServiceSection({ service }: { service: OrgServiceApi }) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>
          {service.workspaceName}
        </h2>
        <span className='text-[var(--text-tertiary)] text-caption'>
          {service.resources.length} {service.resources.length === 1 ? 'resource' : 'resources'}
        </span>
      </div>
      <div className='flex flex-col gap-2'>
        {service.resources.map((r) => (
          <ResourceCard key={r.workflowId} resource={r} />
        ))}
      </div>
    </div>
  )
}

/**
 * The org API catalog. Lists every published resource across the viewer's organization,
 * grouped by workspace-as-service, so a builder can discover what to call and how -
 * without any access to the providing workspaces' data.
 */
export function OrgResources() {
  const hostContext = useOptionalWorkspaceHostContext()
  const organizationId = hostContext?.hostOrganizationId ?? null
  const { data, isLoading, isError } = useOrgResources(organizationId)
  const [search, setSearch] = useState('')

  const services = useMemo(() => {
    const all = data?.services ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all
      .map((service) => ({
        ...service,
        resources: service.resources.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.summary ?? '').toLowerCase().includes(q) ||
            service.workspaceName.toLowerCase().includes(q)
        ),
      }))
      .filter((service) => service.resources.length > 0)
  }, [data, search])

  const totalResources = useMemo(
    () => (data?.services ?? []).reduce((n, s) => n + s.resources.length, 0),
    [data]
  )

  return (
    <div className='flex h-full flex-col overflow-y-auto'>
      <div className='mx-auto w-full max-w-[48rem] px-6 py-8'>
        <div className='mb-1 font-medium text-[var(--text-primary)] text-lg'>Org resources</div>
        <p className='mb-6 text-[var(--text-secondary)] text-small'>
          API resources other workspaces in your organization have published. You can call any of
          these with the right auth header - no access to their workspace required.
        </p>

        <div className='mb-6'>
          <ChipInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search resources...'
          />
        </div>

        {!organizationId ? (
          <EmptyState text='This workspace is not part of an organization, so there are no org resources.' />
        ) : isLoading ? (
          <EmptyState text='Loading org resources...' />
        ) : isError ? (
          <EmptyState text='Could not load org resources.' />
        ) : totalResources === 0 ? (
          <EmptyState text='No resources have been published in your organization yet.' />
        ) : services.length === 0 ? (
          <EmptyState text='No resources match your search.' />
        ) : (
          <div className='flex flex-col gap-6'>
            {services.map((service) => (
              <ServiceSection key={service.workspaceId} service={service} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className='rounded-lg border border-[var(--border-1)] border-dashed p-8 text-center text-[var(--text-secondary)] text-small'>
      {text}
    </div>
  )
}
