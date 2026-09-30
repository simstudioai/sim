'use client'

import type { Project } from '@/app/playground/org/lib/project'

interface EnvironmentsTabProps {
  project: Project
}

/** The project's fork lineage and the resource mappings between its environments. */
export function EnvironmentsTab({ project }: EnvironmentsTabProps) {
  return (
    <div className='flex h-full flex-col gap-2 px-6 py-5'>
      <ul className='flex items-center gap-2'>
        {project.environments.map((environment) => (
          <li
            key={environment.workspaceId}
            className='rounded-[6px] border border-[var(--border)] px-3 py-2 text-[var(--text-body)] text-small'
          >
            {environment.label}
          </li>
        ))}
      </ul>
      <p className='text-[var(--text-muted)] text-small'>
        Resource mappings between environments are on their way.
      </p>
    </div>
  )
}
