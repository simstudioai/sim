'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  ChipCombobox,
  type ComboboxOptionGroup,
  chipFieldSurfaceClass,
  cn,
} from '@sim/emcn'
import { Plus, X } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { AgentSkillsIcon } from '@/components/icons'
import { SkillModal } from '@/app/workspace/[workspaceId]/skills/components/skill-modal'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { type SkillDefinition, useSkills } from '@/hooks/queries/skills'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface StoredSkill {
  skillId: string
  name?: string
}

interface SkillInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

export function SkillInput({
  blockId,
  subBlockId,
  isPreview,
  previewValue,
  disabled,
}: SkillInputProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { config: permissionConfig } = usePermissionConfig()
  const { data: workspaceSkills = [] } = useSkills(workspaceId)
  const [value, setValue] = useSubBlockValue<StoredSkill[]>(blockId, subBlockId)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [editingSkillSnapshot, setEditingSkillSnapshot] = useState<SkillDefinition | null>(null)

  const skillsById = useMemo(
    () => new Map(workspaceSkills.map((skill) => [skill.id, skill])),
    [workspaceSkills]
  )

  // Prefer the live query cache so the modal reflects concurrent edits, but
  // fall back to the click-time snapshot when a background refetch drops the
  // skill — otherwise the modal would close mid-edit and silently discard the
  // draft; saving surfaces the real server error instead.
  const editingSkill = editingSkillId
    ? (skillsById.get(editingSkillId) ?? editingSkillSnapshot)
    : null

  const selectedSkills: StoredSkill[] = useMemo(() => {
    if (isPreview && previewValue) {
      return Array.isArray(previewValue) ? previewValue : []
    }
    return Array.isArray(value) ? value : []
  }, [isPreview, previewValue, value])

  const selectedIds = useMemo(() => new Set(selectedSkills.map((s) => s.skillId)), [selectedSkills])

  const skillsDisabled = permissionConfig.disableSkills

  const skillGroups = useMemo((): ComboboxOptionGroup[] => {
    const groups: ComboboxOptionGroup[] = []

    if (!skillsDisabled) {
      groups.push({
        items: [
          {
            label: 'Create Skill',
            value: 'action-create-skill',
            icon: Plus,
            onSelect: () => {
              setShowCreateModal(true)
            },
            disabled: isPreview,
          },
        ],
      })
    }

    const availableSkills = workspaceSkills.filter((s) => !selectedIds.has(s.id))
    if (!skillsDisabled && availableSkills.length > 0) {
      groups.push({
        section: 'Skills',
        items: availableSkills.map((s) => {
          return {
            label: s.name,
            value: `skill-${s.id}`,
            icon: AgentSkillsIcon,
            onSelect: () => {
              const newSkills: StoredSkill[] = [...selectedSkills, { skillId: s.id, name: s.name }]
              setValue(newSkills)
            },
          }
        }),
      })
    }

    return groups
  }, [workspaceSkills, selectedIds, selectedSkills, setValue, isPreview, skillsDisabled])

  const handleRemove = useCallback(
    (skillId: string) => {
      const newSkills = selectedSkills.filter((s) => s.skillId !== skillId)
      setValue(newSkills)
    },
    [selectedSkills, setValue]
  )

  const handleSkillSaved = useCallback(() => {
    setShowCreateModal(false)
    setEditingSkillId(null)
    setEditingSkillSnapshot(null)
  }, [])

  const resolveSkillName = useCallback(
    (stored: StoredSkill): string => {
      const found = skillsById.get(stored.skillId)
      return found?.name ?? stored.name ?? stored.skillId
    },
    [skillsById]
  )

  return (
    <>
      <div className='w-full space-y-2'>
        <ChipCombobox
          options={[]}
          groups={skillGroups}
          placeholder='Add skill...'
          disabled={disabled}
          searchable
          searchPlaceholder='Search skills...'
          maxHeight={240}
          emptyMessage='No skills found'
        />

        {selectedSkills.length > 0 &&
          selectedSkills.map((stored, index) => {
            const fullSkill = skillsById.get(stored.skillId)
            const skillName = resolveSkillName(stored)
            const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
              activeSearchTarget,
              blockId,
              subBlockId,
              valuePath: [index, 'name'],
              label: skillName,
            })
            return (
              <div
                key={stored.skillId}
                className={cn(
                  'group flex h-[30px] items-center gap-1.5 px-2',
                  chipFieldSurfaceClass
                )}
              >
                <button
                  type='button'
                  className='flex min-w-0 flex-1 items-center gap-1.5 text-left'
                  onClick={() => {
                    if (fullSkill && !disabled && !isPreview) {
                      setEditingSkillId(fullSkill.id)
                      setEditingSkillSnapshot(fullSkill)
                    }
                  }}
                  disabled={!fullSkill || disabled || isPreview}
                >
                  <div className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-sm bg-[var(--border-1)]'>
                    <AgentSkillsIcon className='size-[10px] text-[var(--text-icon)]' />
                  </div>
                  <span className='truncate text-[var(--text-body)] text-sm'>
                    {formatDisplayText(skillName, { workflowSearchHighlight })}
                  </span>
                </button>
                {!disabled && !isPreview && (
                  <Button
                    type='button'
                    variant='quiet'
                    size='icon'
                    onClick={() => handleRemove(stored.skillId)}
                    aria-label='Remove skill'
                  >
                    <X className='size-[14px]' />
                  </Button>
                )}
              </div>
            )
          })}
      </div>

      <SkillModal
        open={showCreateModal || !!editingSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowCreateModal(false)
            setEditingSkillId(null)
            setEditingSkillSnapshot(null)
          }
        }}
        onSave={handleSkillSaved}
        initialValues={editingSkill ?? undefined}
      />
    </>
  )
}
