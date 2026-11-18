/**
 * `@sim/workspace-code` is pure, so it keeps its own copy of the server rules it checks locally and
 * the defaults it fingerprints against. Each copy is held equal to the source of truth here: a
 * drifted rule makes the local check disagree with the server, and a drifted default makes every
 * resource that leaves it undeclared fingerprint as changed.
 */
import { CHAT_DEFAULT_CUSTOMIZATIONS } from '@sim/workspace-code/kinds/deployment'
import {
  CHUNKING_STRATEGIES,
  DEFAULT_CHUNKING,
  KNOWLEDGE_DESCRIPTION_MAX_LENGTH,
  type RECURSIVE_RECIPES,
} from '@sim/workspace-code/kinds/knowledge'
import { TABLE_TEXT_RULES } from '@sim/workspace-code/kinds/table'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { chunkingStrategySchema } from '@/lib/api/contracts/knowledge/base'
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_WELCOME_MESSAGE,
} from '@/lib/chat-deployments/application/workflow-chat-deployment'
import type { RecursiveRecipe } from '@/lib/chunkers/types'
import {
  DEFAULT_CHUNKING_CONFIG,
  KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
} from '@/lib/knowledge/constants'
import { NAME_PATTERN, TABLE_LIMITS } from '@/lib/table/constants'

describe('workspace source mirrors of server rules', () => {
  it('knowledge bases', () => {
    expect(DEFAULT_CHUNKING).toEqual(DEFAULT_CHUNKING_CONFIG)
    expect(KNOWLEDGE_DESCRIPTION_MAX_LENGTH).toBe(KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH)
    expect([...CHUNKING_STRATEGIES].sort()).toEqual([...chunkingStrategySchema.options].sort())
    expectTypeOf<(typeof RECURSIVE_RECIPES)[number]>().toEqualTypeOf<RecursiveRecipe>()
  })

  it('tables', () => {
    expect(TABLE_TEXT_RULES).toEqual({
      namePattern: NAME_PATTERN,
      maxTableName: TABLE_LIMITS.MAX_TABLE_NAME_LENGTH,
      maxColumnName: TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH,
      maxDescription: TABLE_LIMITS.MAX_DESCRIPTION_LENGTH,
    })
    expect(WORKSPACE_SOURCE_LIMITS.maxColumns).toBe(TABLE_LIMITS.MAX_COLUMNS_PER_TABLE)
  })

  it('chat deployments', () => {
    expect(CHAT_DEFAULT_CUSTOMIZATIONS).toEqual({
      primaryColor: DEFAULT_PRIMARY_COLOR,
      welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    })
  })
})
