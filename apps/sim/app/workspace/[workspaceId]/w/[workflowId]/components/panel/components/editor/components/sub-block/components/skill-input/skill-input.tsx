'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus, Sparkles, XIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOptionGroup } from '@/components/emcn'
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
    if (availableSkills.length > 0) {
      groups.push({
        section: 'Skills',
        items: availableSkills.map((s) => {
          return {
            label: s.name,
            value: `skill-${s.id}`,
            icon: Sparkles,
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

        {selectedSkills.length > 0 && (
          <div className='flex flex-wrap gap-[4px]'>
            {selectedSkills.map((stored) => {
              const fullSkill = workspaceSkills.find((s) => s.id === stored.skillId)
              return (
                <div
                  key={stored.skillId}
                  className='flex cursor-pointer items-center gap-[4px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[6px] py-[2px] font-medium text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-6)]'
                  onClick={() => {
                    if (fullSkill && !disabled && !isPreview) {
                      setEditingSkill(fullSkill)
                    }
                  }}
                >
                  <Sparkles className='h-[10px] w-[10px] text-[var(--text-tertiary)]' />
                  <span className='max-w-[140px] truncate'>{resolveSkillName(stored)}</span>
                  {!disabled && !isPreview && (
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemove(stored.skillId)
                      }}
                      className='ml-[2px] rounded-[2px] p-[1px] text-[var(--text-tertiary)] hover:bg-[var(--surface-7)] hover:text-[var(--text-secondary)]'
                    >
                      <XIcon className='h-[10px] w-[10px]' />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
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
