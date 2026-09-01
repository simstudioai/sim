'use client'

import { useMemo, useRef, useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { Check, Plus } from '@sim/emcn/icons'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { SkillTile } from '@/app/workspace/[workspaceId]/components'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { isSkillNameConflictError } from '@/app/workspace/[workspaceId]/skills/components/utils'
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
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<SkillTile />}
      title={skill.name}
      description={skill.description}
      trailing={
        added ? (
          <Chip leftIcon={Check} disabled>
            Added
          </Chip>
        ) : (
          <Chip variant='primary' leftIcon={Plus} onClick={onAdd} disabled={disabled}>
            {pending ? 'Adding...' : 'Add'}
          </Chip>
        )
      }
    />
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
    } catch (error) {
      // A name conflict just means the skill is already in this workspace —
      // everyone with workspace access can already see and use it, so there is
      // nothing to request and retrying can never succeed.
      if (isSkillNameConflictError(error)) {
        toast.error(`"${skill.name}" is already in this workspace`)
      } else {
        toast.error(`Failed to add "${skill.name}" — please try again`)
      }
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
    <SettingsSection label='Skills'>
      <div className={RESOURCE_LIST_STACK}>
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
    </SettingsSection>
  )
}
