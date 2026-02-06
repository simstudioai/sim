'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus, XIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOptionGroup } from '@/components/emcn'
import { AgentSkillsIcon } from '@/components/icons'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { SkillModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/skills/components/skill-modal'
import type { SkillDefinition } from '@/hooks/queries/skills'
import { useSkills } from '@/hooks/queries/skills'
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
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { config: permissionConfig } = usePermissionConfig()
  const { data: workspaceSkills = [] } = useSkills(workspaceId)
  const [value, setValue] = useSubBlockValue<StoredSkill[]>(blockId, subBlockId)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)
  const [open, setOpen] = useState(false)

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
              setOpen(false)
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
              setOpen(false)
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
    setEditingSkill(null)
  }, [])

  const resolveSkillName = useCallback(
    (stored: StoredSkill): string => {
      const found = workspaceSkills.find((s) => s.id === stored.skillId)
      return found?.name ?? stored.name ?? stored.skillId
    },
    [workspaceSkills]
  )

  return (
    <>
      <div className='w-full space-y-[8px]'>
        <Combobox
          options={[]}
          groups={skillGroups}
          placeholder='Add skill...'
          disabled={disabled}
          searchable
          searchPlaceholder='Search skills...'
          maxHeight={240}
          emptyMessage='No skills found'
          onOpenChange={setOpen}
        />

        {selectedSkills.length > 0 &&
          selectedSkills.map((stored) => {
            const fullSkill = workspaceSkills.find((s) => s.id === stored.skillId)
            return (
              <div
                key={stored.skillId}
                className='group relative flex flex-col overflow-hidden rounded-[4px] border border-[var(--border-1)] transition-all duration-200 ease-in-out'
              >
                <div
                  className='flex cursor-pointer items-center justify-between gap-[8px] rounded-t-[4px] bg-[var(--surface-4)] px-[8px] py-[6.5px]'
                  onClick={() => {
                    if (fullSkill && !disabled && !isPreview) {
                      setEditingSkill(fullSkill)
                    }
                  }}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                    <div
                      className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                      style={{ backgroundColor: '#e0e0e0' }}
                    >
                      <AgentSkillsIcon className='h-[10px] w-[10px] text-[#333]' />
                    </div>
                    <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {resolveSkillName(stored)}
                    </span>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-[8px]'>
                    {!disabled && !isPreview && (
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemove(stored.skillId)
                        }}
                        className='flex items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
                        aria-label='Remove skill'
                      >
                        <XIcon className='h-[13px] w-[13px]' />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
      </div>

      <SkillModal
        open={showCreateModal || !!editingSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowCreateModal(false)
            setEditingSkill(null)
          }
        }}
        onSave={handleSkillSaved}
        initialValues={editingSkill ?? undefined}
      />
    </>
  )
}
