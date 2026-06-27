'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { Chip, ChipConfirmModal, ChipInput, Search } from '@/components/emcn'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/integrations/components/integration-tabs-header'
import { ShowcaseWithExplore } from '@/app/workspace/[workspaceId]/integrations/components/showcase-with-explore'
import { SkillModal } from '@/app/workspace/[workspaceId]/skills/components/skill-modal'
import { skillIdParam, skillIdUrlKeys } from '@/app/workspace/[workspaceId]/skills/search-params'
import { useDeleteSkill, useSkills } from '@/hooks/queries/skills'
import { useTranslations } from 'next-intl'

const logger = createLogger('SkillsSettings')

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
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const { data: skills = [], isLoading, error } = useSkills(workspaceId)
  const deleteSkillMutation = useDeleteSkill()

  const [searchTerm, setSearchTerm] = useState('')
  const [editingSkillId, setEditingSkillId] = useQueryState(skillIdParam.key, {
    ...skillIdParam.parser,
    ...skillIdUrlKeys,
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [skillToDelete, setSkillToDelete] = useState<{ id: string; name: string } | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  /** Derive the skill being edited from the loaded list — never store the object in the URL. */
  const editingSkill = editingSkillId ? (skills.find((s) => s.id === editingSkillId) ?? null) : null

  const filteredSkills = skills.filter((s) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      s.name.toLowerCase().includes(searchLower) ||
      s.description.toLowerCase().includes(searchLower)
    )
  })

  const handleDeleteClick = (skillId: string) => {
    const s = skills.find((sk) => sk.id === skillId)
    if (!s) return

    setSkillToDelete({ id: skillId, name: s.name })
    setShowDeleteDialog(true)
  }

  const handleDeleteSkill = async () => {
    if (!skillToDelete) return

    setShowDeleteDialog(false)

    try {
      await deleteSkillMutation.mutateAsync({
        workspaceId,
        skillId: skillToDelete.id,
      })
      logger.info(`Deleted skill: ${skillToDelete.id}`)
    } catch (error) {
      logger.error('Error deleting skill:', error)
    } finally {
      setSkillToDelete(null)
    }
  }

  const handleSkillSaved = () => {
    setShowAddForm(false)
    setEditingSkillId(null)
  }

  const showNoResults = searchTerm.trim() && filteredSkills.length === 0

  const handleOpenAddForm = () => {
    setEditingSkillId(null)
    setShowAddForm(true)
  }

  const addButton = (
    <Chip variant='primary' onClick={handleOpenAddForm} disabled={isLoading} leftIcon={Plus}>
      {t('add_to_sim')}
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
              placeholder={t('search_skills')}
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
                    onClick={() => setEditingSkillId(s.id)}
                  />
                ))}
              </SkillSection>
            ) : showNoResults ? (
              <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                {t('no_skills_found_matching')}{searchTerm}”
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SkillModal
        open={showAddForm || !!editingSkill}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddForm(false)
            setEditingSkillId(null)
          }
        }}
        onSave={handleSkillSaved}
        onDelete={(skillId) => {
          setEditingSkillId(null)
          handleDeleteClick(skillId)
        }}
        initialValues={editingSkill ?? undefined}
      />

      <ChipConfirmModal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        srTitle='Delete Skill'
        title={t('delete_skill')}
        text={[
          'Are you sure you want to delete ',
          { text: skillToDelete?.name ?? 'this skill', bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDeleteSkill,
        }}
      />
    </div>
  )
}
