'use client'

import { useMemo, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import {
  ItemCard,
  ItemList,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/item-card/item-card'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/skill-input/skill-input.module.css'
import { SkillModal } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/skill-input/skill-modal'
import { useSubBlockValue, useWorkflowScope } from '@/platform/lib/data/workflow-editor'
import {
  type SkillDefinition,
  usePermissionConfig,
  useSkills,
} from '@/platform/lib/data/workflow-editor/mcp'

/** A skill attached to the block; `name` is the label at the time it was added. */
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

function isStoredSkill(value: unknown): value is StoredSkill {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { skillId?: unknown }).skillId === 'string'
  )
}

function toStoredSkills(value: unknown): StoredSkill[] {
  return Array.isArray(value) ? value.filter(isStoredSkill) : []
}

/**
 * The skills an agent block carries: a picker adds a workspace skill or creates one, each row
 * opens its skill for editing, and its × detaches it from the block.
 */
export function SkillInput({
  blockId,
  subBlockId,
  isPreview,
  previewValue,
  disabled,
}: SkillInputProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
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

  // The live cache reflects concurrent edits; the click-time snapshot keeps the modal and its
  // draft open if a refetch drops the skill, so saving surfaces the real server error.
  const editingSkill = editingSkillId
    ? (skillsById.get(editingSkillId) ?? editingSkillSnapshot)
    : null

  const selectedSkills =
    isPreview && previewValue ? toStoredSkills(previewValue) : toStoredSkills(value)
  const selectedIds = new Set(selectedSkills.map((skill) => skill.skillId))
  const skillsDisabled = permissionConfig.disableSkills
  const editable = !disabled && !isPreview

  const options = skillsDisabled
    ? []
    : workspaceSkills
        .filter((skill) => !selectedIds.has(skill.id))
        .map((skill) => ({ value: skill.id, label: skill.name, leading: <Icon name='I044' /> }))

  const addSkill = (skillId: string | null) => {
    const skill = skillId ? skillsById.get(skillId) : undefined
    if (!skill) return
    setValue([...selectedSkills, { skillId: skill.id, name: skill.name }])
  }

  const removeSkill = (skillId: string) => {
    setValue(selectedSkills.filter((skill) => skill.skillId !== skillId))
  }

  const closeModal = () => {
    setShowCreateModal(false)
    setEditingSkillId(null)
    setEditingSkillSnapshot(null)
  }

  return (
    <div className={styles.skills}>
      <SearchableSelect
        label='Add skill'
        labelHidden
        placeholder='Add skill…'
        searchLabel='Search skills'
        options={options}
        value={null}
        onValueChange={addSkill}
        disabled={disabled}
        createLabel={skillsDisabled || isPreview ? undefined : 'Create skill'}
        onCreate={() => setShowCreateModal(true)}
      />
      {selectedSkills.length > 0 && (
        <ItemList label='Skills'>
          {selectedSkills.map((stored, index) => {
            const fullSkill = skillsById.get(stored.skillId)
            const skillName = fullSkill?.name ?? stored.name ?? stored.skillId
            const label = formatDisplayText(skillName, {
              workflowSearchHighlight: getWorkflowSearchLabelHighlight({
                activeSearchTarget,
                blockId,
                subBlockId,
                valuePath: [index, 'name'],
                label: skillName,
              }),
            })
            return (
              <li key={stored.skillId}>
                <ItemCard
                  icon='I044'
                  name={label}
                  title={skillName}
                  expandable={false}
                  expanded={false}
                  onActivate={
                    fullSkill && editable
                      ? () => {
                          setEditingSkillId(fullSkill.id)
                          setEditingSkillSnapshot(fullSkill)
                        }
                      : undefined
                  }
                  actions={
                    editable && (
                      <IconButton
                        label={`Remove ${skillName}`}
                        icon='I105'
                        size='compact'
                        onClick={() => removeSkill(stored.skillId)}
                      />
                    )
                  }
                />
              </li>
            )
          })}
        </ItemList>
      )}
      <SkillModal
        workspaceId={workspaceId}
        open={showCreateModal || !!editingSkill}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeModal()
        }}
        onSave={closeModal}
        initialValues={editingSkill ?? undefined}
      />
    </div>
  )
}
