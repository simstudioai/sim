'use client'

import {
  MemberRow,
  SKILL_EDITOR_ROLE_OPTIONS,
  type SkillEditorRole,
  skillEditorLockReason,
} from '@/components/permissions'
import { DetailSection } from '@/app/workspace/[workspaceId]/components/credential-detail'
import type { SkillEditorsController } from '@/app/workspace/[workspaceId]/skills/components/skill-members'

interface SkillEditorsCardProps {
  editors: SkillEditorsController
  /** Whether the viewer can edit the skill (and therefore manage its editors). */
  canEdit: boolean
}

/**
 * Page-styled editor roster for the skill detail page: workspace admins
 * (derived, always editors) and explicitly added editors. Everyone in the
 * workspace can already see and use the skill — this list gates editing only.
 * Adding people happens through the header Share action.
 *
 * Rows are the shared {@link MemberRow} so the roster is chrome-identical to the
 * credential detail surface. Skill membership is binary, so the role control
 * carries a single `Editor` option and is disabled on every row; a derived
 * (workspace-admin) row also locks Remove and explains the inheritance on hover.
 */
export function SkillEditorsCard({ editors, canEdit }: SkillEditorsCardProps) {
  return (
    <DetailSection title={`Skill Editors (${editors.editors.length})`}>
      {editors.editorsError ? (
        <span className='text-[var(--text-muted)] text-caption'>
          Couldn't load editors. You may no longer have access to this skill.
        </span>
      ) : editors.editorsLoading ? null : (
        <div className='flex flex-col gap-2'>
          {editors.editors.map((editor) => (
            <MemberRow<SkillEditorRole>
              key={editor.id}
              member={{
                userId: editor.userId,
                userName: editor.userName,
                userEmail: editor.userEmail,
                role: 'editor',
              }}
              roleOptions={SKILL_EDITOR_ROLE_OPTIONS}
              lockReason={skillEditorLockReason(editor.isWorkspaceAdmin)}
              canManage={canEdit}
              roleDisabled
              removeDisabled={editor.isWorkspaceAdmin}
              onRemove={() => editors.removeEditor(editor.userId)}
            />
          ))}
        </div>
      )}
    </DetailSection>
  )
}
