'use client'

import { useMemo, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { usePostHog } from 'posthog-js/react'
import { Chip } from '@/components/emcn'
import { AgentSkillsIcon } from '@/components/icons'
import { captureEvent } from '@/lib/posthog/client'
import type { SuggestedSkill } from '@/blocks/types'
import { useCreateSkill, useSkills } from '@/hooks/queries/skills'

interface IntegrationSkillsSectionProps {
  skills: readonly SuggestedSkill[]
  workspaceId: string
  integrationType: string
}

function SkillTile() {
  return (
    <div className='size-9 flex-shrink-0'>
      <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'>
        <AgentSkillsIcon className='size-5 text-[var(--text-icon)]' />
      </div>
    </div>
  )
}

interface SkillRowProps {
  skill: SuggestedSkill
  added: boolean
  pending: boolean
  onAdd: () => void
}

function SkillRow({ skill, added, pending, onAdd }: SkillRowProps) {
  return (
    <div className='flex items-center gap-2.5 rounded-lg p-2'>
      <SkillTile />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[14px] text-[var(--text-body)]'>{skill.name}</span>
        <span className='truncate text-[12px] text-[var(--text-muted)]'>{skill.description}</span>
      </div>
      {added ? (
        <Chip variant='filled' leftIcon={Check} disabled flush>
          Added
        </Chip>
      ) : (
        <Chip variant='primary' leftIcon={Plus} onClick={onAdd} disabled={pending} flush>
          {pending ? 'Adding...' : 'Add'}
        </Chip>
      )}
    </div>
  )
}

/**
 * Curated, research-backed skills for an integration. Each row adds the skill
 * to the workspace via the same `useCreateSkill` mutation the Skills page uses;
 * a skill already present in the workspace (matched by name) renders as
 * "Added" instead of an add button.
 */
export function IntegrationSkillsSection({
  skills,
  workspaceId,
  integrationType,
}: IntegrationSkillsSectionProps) {
  const posthog = usePostHog()
  const { data: existingSkills = [] } = useSkills(workspaceId)
  const createSkill = useCreateSkill()
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [optimisticAdded, setOptimisticAdded] = useState<ReadonlySet<string>>(new Set())

  const existingNames = useMemo(() => new Set(existingSkills.map((s) => s.name)), [existingSkills])

  const handleAdd = async (skill: SuggestedSkill, position: number) => {
    setPendingName(skill.name)
    try {
      await createSkill.mutateAsync({ workspaceId, skill })
      // Mark added locally so the row flips to "Added" immediately — the list
      // refetch that backs `existingNames` lands after this mutation resolves.
      setOptimisticAdded((prev) => new Set(prev).add(skill.name))
      captureEvent(posthog, 'integration_skill_added', {
        workspace_id: workspaceId,
        integration_type: integrationType,
        skill_name: skill.name,
        position,
        skill_count: skills.length,
      })
    } finally {
      setPendingName(null)
    }
  }

  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>Skills</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      <div className='-mx-2 flex flex-col gap-y-0.5'>
        {skills.map((skill, index) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            added={existingNames.has(skill.name) || optimisticAdded.has(skill.name)}
            pending={pendingName === skill.name}
            onAdd={() => handleAdd(skill, index)}
          />
        ))}
      </div>
    </section>
  )
}
