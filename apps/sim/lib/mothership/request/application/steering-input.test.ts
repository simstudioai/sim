/**
 * @vitest-environment node
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { describe, expect, it, vi } from 'vitest'
import { prepareSteeringInput } from '@/lib/mothership/request/application/steering-input'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

describe('prepareSteeringInput', () => {
  it('fails the steer when the workspace permission lookup fails, rather than dropping its files', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockRejectedValueOnce(
      new Error('connection terminated')
    )

    await expect(
      prepareSteeringInput({
        principal: createSessionPrincipal({ userId: 'user-1' }),
        chat: { userId: 'user-1', chatId: 'chat-1', workspaceId: 'workspace-1' },
        input: {
          steeringId: 'steer-1',
          content: 'Use this file',
          fileAttachments: [
            {
              id: 'file-1',
              key: 'workspace/workspace-1/report.pdf',
              filename: 'report.pdf',
              media_type: 'application/pdf',
              size: 10,
            },
          ],
        },
      })
    ).rejects.toThrow('connection terminated')
  })
})
