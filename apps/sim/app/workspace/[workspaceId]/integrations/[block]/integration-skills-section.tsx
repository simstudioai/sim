'use client'

import { useMemo, useRef, useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { Check, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import type { SuggestedSkill } from '@/blocks/types'
import { useCreateSkill, useSkills } from '@/hooks/queries/skills'

interface IntegrationSkillsSectionProps {
  skills: readonly SuggestedSkill[]
  workspaceId: string
  integrationType: string
}

interface SkillRowProps {
  skill: SuggestedSkill
  added: boolean
  pending: boolean
  disabled: boolean
  onAdd: () => void
}

function SkillRow({ skill, added, pending, disabled, onAdd }: SkillRowProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  return (
    <div className='flex items-center gap-2.5 rounded-lg p-2'>
      <SkillTile />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[14px] text-[var(--text-body)]'>{skill.name}</span>
        <span className='truncate text-[12px] text-[var(--text-muted)]'>{skill.description}</span>
      </div>
      {added ? (
        <Chip leftIcon={Check} disabled flush>
          {t('added')}
        </Chip>
      ) : (
        <Chip variant='primary' leftIcon={Plus} onClick={onAdd} disabled={disabled} flush>
          {pending ? 'Adding...' : tI18n('add')}
        </Chip>
      )}
    </div>
  )
}

/**
 * Curated, research-backed skills for an integration. Each row adds the skill
 * to the workspace via the same `useCreateSkill` mutation the Skills page uses;
 * `useSkills` is the single source of truth for the "Added" state, so a skill
 * removed elsewhere correctly reverts to "Add".
 */
export function IntegrationSkillsSection({
  skills,
  workspaceId,
  integrationType,
}: IntegrationSkillsSectionProps) {
  const t = useTranslations('auto')
  const posthog = usePostHog()
  const { data: existingSkills = [], isPending, isPlaceholderData } = useSkills(workspaceId)
  const createSkill = useCreateSkill()
  const skillsReady = !isPending && !isPlaceholderData
  const [pendingNames, setPendingNames] = useState<ReadonlySet<string>>(new Set())
  const inFlightRef = useRef<Set<string>>(new Set())

  const existingNames = useMemo(() => new Set(existingSkills.map((s) => s.name)), [existingSkills])

  const handleAdd = async (skill: SuggestedSkill, position: number) => {
    if (inFlightRef.current.has(skill.name)) return
    inFlightRef.current.add(skill.name)
    setPendingNames((prev) => new Set(prev).add(skill.name))
    try {
      await createSkill.mutateAsync({ workspaceId, skill })
      captureEvent(posthog, 'integration_skill_added', {
        workspace_id: workspaceId,
        integration_type: integrationType,
        skill_name: skill.name,
        position,
        skill_count: skills.length,
      })
    } catch {
      toast.error(`Failed to add "${skill.name}" — please try again`)
    } finally {
      inFlightRef.current.delete(skill.name)
      setPendingNames((prev) => {
        const next = new Set(prev)
        next.delete(skill.name)
        return next
      })
    }
  }

  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>{t('skills')}</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      <div className='-mx-2 flex flex-col gap-y-0.5'>
        {skills.map((skill, index) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            added={skillsReady && existingNames.has(skill.name)}
            pending={pendingNames.has(skill.name)}
            disabled={pendingNames.has(skill.name) || !skillsReady}
            onAdd={() => handleAdd(skill, index)}
          />
        ))}
      </div>
    </section>
  )
}
