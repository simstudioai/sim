'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import {
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
  Search,
} from '@/components/emcn'
import { ArrowRight, Plus } from '@/components/emcn/icons'
import { AgentSkillsIcon } from '@/components/icons'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/integrations/components/integration-tabs-header'
import { ShowcaseWithExplore } from '@/app/workspace/[workspaceId]/integrations/components/showcase-with-explore'
import { SkillModal } from '@/app/workspace/[workspaceId]/skills/components/skill-modal'
import {
  getSampleSkills,
  PREVIEW_SKILLS_WITH_SAMPLES,
} from '@/app/workspace/[workspaceId]/skills/fixtures/sample-skills'
import type { SkillDefinition } from '@/hooks/queries/skills'
import { useDeleteSkill, useSkills } from '@/hooks/queries/skills'

const logger = createLogger('SkillsSettings')

const SKILLS_LABEL = 'Skills'

function SkillTile() {
  return (
    <div className='size-9 flex-shrink-0'>
      <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'>
        <AgentSkillsIcon className='size-5 text-[var(--text-icon)]' />
      </div>
    </div>
  )
}

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
  const workspaceId = (params?.workspaceId as string) || ''

  const { data: skills = [], isLoading, error } = useSkills(workspaceId)
  const deleteSkillMutation = useDeleteSkill()

  const [searchTerm, setSearchTerm] = useState('')
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [skillToDelete, setSkillToDelete] = useState<{ id: string; name: string } | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const allSkills = useMemo(() => {
    if (!PREVIEW_SKILLS_WITH_SAMPLES) return skills
    return [...getSampleSkills(workspaceId), ...skills]
  }, [skills, workspaceId])

  const filteredSkills = allSkills.filter((s) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      s.name.toLowerCase().includes(searchLower) ||
      s.description.toLowerCase().includes(searchLower)
    )
  })

  const handleDeleteClick = (skillId: string) => {
    const s = allSkills.find((sk) => sk.id === skillId)
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
    setEditingSkill(null)
  }

  const showNoResults = searchTerm.trim() && filteredSkills.length === 0

  const addButton = (
    <Chip
      variant='primary'
      onClick={() => setShowAddForm(true)}
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
                    onClick={() => setEditingSkill(s)}
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

      <SkillModal
        open={showAddForm || !!editingSkill}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddForm(false)
            setEditingSkill(null)
          }
        }}
        onSave={handleSkillSaved}
        onDelete={(skillId) => {
          setEditingSkill(null)
          handleDeleteClick(skillId)
        }}
        initialValues={editingSkill ?? undefined}
      />

      <ChipModal open={showDeleteDialog} onOpenChange={setShowDeleteDialog} srTitle='Delete Skill'>
        <ChipModalHeader showDivider={false}>Delete Skill</ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{skillToDelete?.name}</span>?{' '}
            This action cannot be undone.
          </p>
        </ChipModalBody>
        <ChipModalFooter>
          <Chip variant='filled' flush onClick={() => setShowDeleteDialog(false)}>
            Cancel
          </Chip>
          <Chip variant='destructive' flush onClick={handleDeleteSkill}>
            Delete
          </Chip>
        </ChipModalFooter>
      </ChipModal>
    </div>
  )
}
