'use client'

import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import type { AddPeopleTarget } from '@/components/permissions'
import type { SkillEditor } from '@/lib/api/contracts'
import { useRemoveSkillMember, useSkillMembers, useUpsertSkillMember } from '@/hooks/queries/skills'

const logger = createLogger('SkillEditorsController')

export interface SkillEditorsController {
  editors: SkillEditor[]
  editorsLoading: boolean
  editorsError: boolean
  /** Lowercased emails already on the roster (incl. workspace admins) — feeds the Add People modal. */
  existingEditorEmails: Set<string>
  addEditor: (target: AddPeopleTarget) => Promise<unknown>
  removeEditor: (userId: string) => Promise<void>
}

interface UseSkillEditorsControllerParams {
  skillId: string
  workspaceId: string
  /** Gate the roster fetch off (e.g. built-in template skills have no editors). */
  enabled?: boolean
}

/**
 * Data + mutation controller behind the skill editor surfaces (the detail
 * page's Skill Editors section and the Share modal): exposes the roster —
 * explicit editors plus derived workspace admins — and the add/remove actions.
 * Renderers own only chrome.
 */
export function useSkillEditorsController({
  skillId,
  workspaceId,
  enabled = true,
}: UseSkillEditorsControllerParams): SkillEditorsController {
  const {
    data: editors = [],
    isPending: editorsLoading,
    isError: editorsError,
  } = useSkillMembers(skillId, { enabled })
  const { mutateAsync: upsertEditorAsync } = useUpsertSkillMember()
  const { mutateAsync: removeEditorAsync } = useRemoveSkillMember()

  const existingEditorEmails = useMemo(
    () => new Set(editors.map((editor) => (editor.userEmail ?? '').toLowerCase()).filter(Boolean)),
    [editors]
  )

  const addEditor = useCallback(
    (target: AddPeopleTarget) => upsertEditorAsync({ skillId, workspaceId, userId: target.userId }),
    [upsertEditorAsync, skillId, workspaceId]
  )

  const removeEditor = useCallback(
    async (userId: string) => {
      try {
        await removeEditorAsync({ skillId, workspaceId, userId })
      } catch (error) {
        logger.error('Failed to remove skill editor', error)
      }
    },
    [removeEditorAsync, skillId, workspaceId]
  )

  return {
    editors,
    editorsLoading,
    editorsError,
    existingEditorEmails,
    addEditor,
    removeEditor,
  }
}
