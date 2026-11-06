'use client'

import { useState } from 'react'
import type {
  SkillsData,
  WorkspaceSkill,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/skills/_components/skill-detail/skill-detail.module.css'
import { ActionMenu, Avatar, Modal, MultiSelect } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

interface SkillEditorsProps {
  skill: WorkspaceSkill
  data: SkillsData
  sharing: boolean
  onClose: () => void
  onSave: (skill: WorkspaceSkill) => void
}

export function SkillEditors({ skill, data, sharing, onClose, onSave }: SkillEditorsProps) {
  const [selected, setSelected] = useState<string[]>([])
  const canEdit = skill.access === 'editor'
  const editors = data.members.filter(
    (member) => member.admin || skill.editorIds.includes(member.id)
  )
  const available = data.members.filter((member) => !editors.includes(member))
  function close() {
    setSelected([])
    onClose()
  }
  return (
    <>
      <SettingsSection title={`Skill editors (${editors.length})`}>
        {editors.map((member) => (
          <SettingsRow
            key={member.id}
            label={member.name}
            description={member.email}
            leading={<Avatar name={member.name} size='inline' />}
          >
            <div className={styles.actions}>
              <span data-type='T052' className={styles.role}>
                {member.admin ? 'Workspace admin' : 'Editor'}
              </span>
              {canEdit && !member.admin && (
                <ActionMenu
                  label={`Actions for ${member.name}`}
                  icon='I108'
                  triggerSize='compact'
                  align='end'
                  tooltip={false}
                  actions={[
                    {
                      id: 'remove',
                      label: 'Remove',
                      destructive: true,
                      onSelect: () =>
                        onSave({
                          ...skill,
                          access: member.id === data.viewerId ? 'viewer' : skill.access,
                          editorIds: skill.editorIds.filter((id) => id !== member.id),
                        }),
                    },
                  ]}
                />
              )}
            </div>
          </SettingsRow>
        ))}
      </SettingsSection>
      {canEdit && (
        <Modal
          title='Share skill'
          description='Workspace members can use this skill. Add editors to let them change it.'
          open={sharing}
          onOpenChange={(open) => {
            if (!open) close()
          }}
          confirmLabel='Add editors'
          confirmDisabled={selected.length === 0}
          onConfirm={() => onSave({ ...skill, editorIds: [...skill.editorIds, ...selected] })}
        >
          <MultiSelect
            label='Workspace members'
            searchLabel='Search workspace members'
            placeholder={available.length ? 'Select people' : 'Everyone is an editor'}
            disabled={!available.length}
            options={available.map((member) => ({
              value: member.id,
              label: `${member.name} · ${member.email}`,
            }))}
            value={selected}
            onValueChange={setSelected}
          />
        </Modal>
      )}
    </>
  )
}
