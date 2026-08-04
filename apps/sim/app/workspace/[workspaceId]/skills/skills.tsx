'use client'

import { useEffect, useRef } from 'react'
import { Chip, ChipInput, Search } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { IntegrationTabsHeader, SkillTile } from '@/app/workspace/[workspaceId]/components'
import { ShowcaseWithExplore } from '@/app/workspace/[workspaceId]/integrations/components/showcase-with-explore'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_GRID,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  skillIdParam,
  skillIdUrlKeys,
  skillSearchParam,
  skillSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/skills/search-params'
import { useSkills } from '@/hooks/queries/skills'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

const SKILLS_LABEL = 'Skills'

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
              className='min-w-0 flex-1'
            />
          </div>

          <div className='flex flex-col gap-7'>
            {error ? (
              <SettingsEmptyState variant='inline' tone='error'>
                {getErrorMessage(error, 'Failed to load skills')}
              </SettingsEmptyState>
            ) : filteredSkills.length > 0 ? (
              <SettingsSection label={SKILLS_LABEL}>
                <div className={RESOURCE_LIST_GRID}>
                  {filteredSkills.map((s) => (
                    <SettingsResourceRow
                      key={s.id}
                      iconVariant='custom'
                      icon={<SkillTile />}
                      title={s.name}
                      description={s.description || undefined}
                      onClick={() => router.push(`${skillsHref}/${s.id}`)}
                      clickLabel={`Open ${s.name}`}
                      navigable
                    />
                  ))}
                </div>
              </SettingsSection>
            ) : showNoResults ? (
              <SettingsEmptyState variant='inline'>
                No skills found matching “{searchTerm}”
              </SettingsEmptyState>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
