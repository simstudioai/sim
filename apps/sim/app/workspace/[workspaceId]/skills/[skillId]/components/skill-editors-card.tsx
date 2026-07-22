'use client'

import { Avatar, AvatarFallback, Chip } from '@sim/emcn'
import { getUserColor } from '@/lib/workspaces/colors'
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
 */
export function SkillEditorsCard({ editors, canEdit }: SkillEditorsCardProps) {
  return (
    <DetailSection title={`Skill Editors (${editors.editors.length})`}>
      {editors.editorsError ? (
        <span className='text-[12px] text-[var(--text-muted)]'>
          Couldn't load editors. You may no longer have access to this skill.
        </span>
      ) : editors.editorsLoading ? null : (
        <div className='flex flex-col gap-2'>
          {editors.editors.map((editor) => (
            <div key={editor.id} className='flex items-center justify-between gap-2'>
              <div className='flex min-w-0 items-center gap-2.5'>
                <Avatar className='size-9 flex-shrink-0'>
                  <AvatarFallback
                    style={{ background: getUserColor(editor.userId || editor.userEmail || '') }}
                    className='border border-[var(--border-1)] text-small text-white'
                  >
                    {(editor.userName || editor.userEmail || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className='flex min-w-0 flex-col'>
                  <span className='truncate text-[14px] text-[var(--text-body)]'>
                    {editor.userName || editor.userEmail || editor.userId}
                  </span>
                  <span className='truncate text-[12px] text-[var(--text-muted)]'>
                    {editor.userEmail || editor.userId}
                  </span>
                </div>
              </div>
              {editor.isWorkspaceAdmin ? (
                <span className='text-[12px] text-[var(--text-muted)]'>Workspace admin</span>
              ) : canEdit ? (
                <Chip onClick={() => editors.removeEditor(editor.userId)} flush>
                  Remove
                </Chip>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  )
}
