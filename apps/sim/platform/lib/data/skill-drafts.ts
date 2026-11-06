'use client'

import {
  parseSkillMarkdown,
  readSkillFile,
  SKILL_IMPORT_ACCEPT,
  validateSkillName,
} from '@/app/workspace/[workspaceId]/skills/components/utils'

export const skillFile = {
  accept: SKILL_IMPORT_ACCEPT,
  read: readSkillFile,
  parse: parseSkillMarkdown,
  nameError: validateSkillName,
}
