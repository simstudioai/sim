import { IdentityTile } from '@/components/identity-tile/identity-tile'

/** How many project marks a chat row shows before summarizing the rest as a count. */
const MAX_MARKS = 2

interface ProjectMarksProps {
  /** The projects a chat worked in, one entry per project. */
  projects: readonly { id: string; name: string }[]
}

/** The marks of the projects a chat touched, leading its row in the Chats section. */
export function ProjectMarks({ projects }: ProjectMarksProps) {
  if (projects.length === 0) return null
  const names = projects.map((project) => project.name).join(', ')
  const extra = projects.length - MAX_MARKS
  return (
    <span
      role='img'
      aria-label={`Projects: ${names}`}
      title={names}
      className='flex shrink-0 items-center gap-0.5'
    >
      {projects.slice(0, MAX_MARKS).map((project) => (
        <IdentityTile key={project.id} initial={project.name[0] ?? '?'} />
      ))}
      {extra > 0 ? <span className='text-[var(--text-muted)] text-caption'>+{extra}</span> : null}
    </span>
  )
}
