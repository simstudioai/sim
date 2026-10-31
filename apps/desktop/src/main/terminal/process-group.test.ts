import { describe, expect, it } from 'vitest'
import { windowsProcessGroups } from '@/main/terminal/process-group'

const SHELL_PID = 100
const COMMAND_TYPED_AT = 1_000_000

describe('the Windows foreground command', () => {
  it('is the children started since the command was typed, never earlier background work', async () => {
    const groups = windowsProcessGroups(async () => [
      { pid: 201, createdAt: COMMAND_TYPED_AT - 60_000 },
      { pid: 202, createdAt: COMMAND_TYPED_AT },
      { pid: 203, createdAt: COMMAND_TYPED_AT + 15 },
    ])

    await expect(groups.foreground(SHELL_PID, COMMAND_TYPED_AT)).resolves.toEqual([202, 203])
  })
})
