/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addCopilotChatResourceBodySchema,
  removeCopilotChatResourceBodySchema,
  reorderCopilotChatResourcesBodySchema,
} from '@/lib/api/contracts/copilot'
import {
  addMothershipChatResourceContract,
  removeMothershipChatResourceContract,
  reorderMothershipChatResourcesContract,
} from '@/lib/api/contracts/mothership-chats'
import { MothershipResourceType } from '@/lib/copilot/resources/types'

/**
 * The /api/mothership/chat/resources routes are SHIMS that delegate to the
 * copilot handlers, so the mothership and copilot contract families describe
 * the same physical boundary and must stay in sync. These tests pin the
 * parity invariants so a one-sided schema edit fails here instead of
 * surfacing as a silent client-side ZodError or a delegated 400 (both
 * happened before these tests existed).
 */

const CHAT_ID = 'chat-1'

describe('copilot resource type enum covers every MothershipResourceType', () => {
  it.each(Object.values(MothershipResourceType))(
    'accepts %s (a stored row of this type must survive the delegated parse)',
    (type) => {
      expect(
        removeCopilotChatResourceBodySchema.safeParse({
          chatId: CHAT_ID,
          resourceType: type,
          resourceId: 'wf_x',
        }).success
      ).toBe(true)
    }
  )

  it('still rejects unknown types', () => {
    expect(
      removeCopilotChatResourceBodySchema.safeParse({
        chatId: CHAT_ID,
        resourceType: 'not-a-real-type',
        resourceId: 'wf_x',
      }).success
    ).toBe(false)
  })
})

describe('mothership request schemas match the delegated copilot boundary', () => {
  const validResource = { type: 'file', id: 'wf_x', title: 'T' }
  const emptyIdResource = { type: 'file', id: '', title: 'T' }

  it('remove: BOTH sides accept an empty resourceId (legacy-row deletion path)', () => {
    const body = { chatId: CHAT_ID, resourceType: 'file', resourceId: '' }
    expect(removeMothershipChatResourceContract.body?.safeParse(body).success).toBe(true)
    expect(removeCopilotChatResourceBodySchema.safeParse(body).success).toBe(true)
  })

  it('add: BOTH sides reject an empty resource id and accept a valid one', () => {
    for (const [resource, expected] of [
      [emptyIdResource, false],
      [validResource, true],
    ] as const) {
      const body = { chatId: CHAT_ID, resource }
      expect(addMothershipChatResourceContract.body?.safeParse(body).success).toBe(expected)
      expect(addCopilotChatResourceBodySchema.safeParse(body).success).toBe(expected)
    }
  })

  it('reorder: BOTH sides reject an empty resource id and accept a valid one', () => {
    for (const [resource, expected] of [
      [emptyIdResource, false],
      [validResource, true],
    ] as const) {
      const body = { chatId: CHAT_ID, resources: [resource] }
      expect(reorderMothershipChatResourcesContract.body?.safeParse(body).success).toBe(expected)
      expect(reorderCopilotChatResourcesBodySchema.safeParse(body).success).toBe(expected)
    }
  })

  it('mothership RESPONSES stay permissive: a not-yet-cleaned legacy empty-id row validates', () => {
    expect(
      addMothershipChatResourceContract.response.schema.safeParse({
        success: true,
        resources: [emptyIdResource],
      }).success
    ).toBe(true)
  })
})
