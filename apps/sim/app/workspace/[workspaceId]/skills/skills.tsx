'use client'

import { useEffect, useRef } from 'react'
import { Chip, ChipInput, Search } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/integrations/components/integration-tabs-header'
import { ShowcaseWithExplore } from '@/app/workspace/[workspaceId]/integrations/components/showcase-with-explore'
import {
  skillIdParam,
  skillIdUrlKeys,
  skillSearchParam,
  skillSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/skills/search-params'
import { useSkills } from '@/hooks/queries/skills'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

const SKILLS_LABEL = 'Skills'

interface SkillItemProps {
  name: string
  description: string
  onClick: () => void
}

function SkillItem({ name, description, onClick }: SkillItemProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
    >
      <SkillTile />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[14px] text-[var(--text-body)]'>{name}</span>
        {description && (
          <span className='truncate text-[12px] text-[var(--text-muted)]'>{description}</span>
        )}
      </div>
      <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}

interface SkillSectionProps {
  label: string
  children: React.ReactNode
}

function SkillSection({ label, children }: SkillSectionProps) {
  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>{label}</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      <div className='-mx-2 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-2 gap-y-0.5'>
        {children}
      </div>
    </section>
  )
}

export function Skills() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''
  const skillsHref = `/workspace/${workspaceId}/skills`

  const { data: skills = [], isLoading, error } = useSkills(workspaceId)

  const [searchTerm, setSearchTermParam] = useQueryState(skillSearchParam.key, {
    ...skillSearchParam.parser,
    ...skillSearchUrlKeys,
  })
  const [legacySkillId, setLegacySkillId] = useQueryState(skillIdParam.key, {
    ...skillIdParam.parser,
    ...skillIdUrlKeys,
  })
  /**
   * Legacy deep links opened the edit modal via `?skillId=`; skills now have a
   * dedicated detail page. Redirect once, stripping the param.
   */
  const redirectedLegacyId = useRef(false)
  useEffect(() => {
    if (!legacySkillId || redirectedLegacyId.current) return
    redirectedLegacyId.current = true
    setLegacySkillId(null, { history: 'replace' })
    router.replace(`${skillsHref}/${legacySkillId}`)
  }, [legacySkillId, setLegacySkillId, router, skillsHref])

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. Filtering below is cheap in-memory over a small list,
   * so it reads the instant value too.
   */
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)

  const filteredSkills = skills.filter((s) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.trim().toLowerCase()
    return (
      s.name.toLowerCase().includes(searchLower) ||
      s.description.toLowerCase().includes(searchLower)
    )
  })

  const showNoResults = searchTerm.trim() && filteredSkills.length === 0

  const addButton = (
    <Chip
      variant='primary'
      onClick={() => router.push(`${skillsHref}/new`)}
      disabled={isLoading}
      leftIcon={Plus}
    >
      Add to Sim
    </Chip>
  )

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='skills' workspaceId={workspaceId} rightSlot={addButton} />
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <ShowcaseWithExplore prompt='Explain the skills in Sim and which ones I should add to my agents.' />
          <div className='flex items-center gap-2'>
            <ChipInput
              icon={Search}
              placeholder='Search skills...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className='flex-1'
            />
          </div>

          <div className='flex flex-col gap-7'>
            {error ? (
              <div className='py-4 text-center text-[var(--error)] text-sm'>
                {getErrorMessage(error, 'Failed to load skills')}
              </div>
            ) : filteredSkills.length > 0 ? (
              <SkillSection label={SKILLS_LABEL}>
                {filteredSkills.map((s) => (
                  <SkillItem
                    key={s.id}
                    name={s.name}
                    description={s.description}
                    onClick={() => router.push(`${skillsHref}/${s.id}`)}
                  />
                ))}
              </SkillSection>
            ) : showNoResults ? (
              <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                No skills found matching “{searchTerm}”
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
