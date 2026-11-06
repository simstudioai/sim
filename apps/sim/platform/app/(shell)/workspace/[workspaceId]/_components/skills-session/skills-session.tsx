'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type {
  SkillsData,
  WorkspaceSkill,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/model'

type SkillEdits = Record<string, WorkspaceSkill | null>

function useEdits() {
  return useState<SkillEdits>({})
}

const Edits = createContext<ReturnType<typeof useEdits> | null>(null)

export function SkillsSession({ children }: { children: ReactNode }) {
  const edits = useEdits()
  return <Edits.Provider value={edits}>{children}</Edits.Provider>
}

export function useWorkspaceSkills(data: SkillsData | null) {
  const session = useContext(Edits)
  if (!session) throw new Error('Skills must be rendered in the workspace layout')
  const [edits, setEdits] = session
  const skills = new Map(data?.skills.map((skill) => [skill.id, skill]))
  if (data) {
    for (const [id, item] of Object.entries(edits)) {
      if (item) skills.set(id, item)
      else skills.delete(id)
    }
  }
  return {
    skills: Array.from(skills.values()),
    change(id: string, skill: WorkspaceSkill | null) {
      setEdits((current) => ({ ...current, [id]: skill }))
    },
  }
}
