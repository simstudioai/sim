/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installUpdate, announceUpdateIfAvailable } = vi.hoisted(() => ({
  installUpdate: vi.fn(),
  announceUpdateIfAvailable: vi.fn(),
}))

vi.mock('#sim-cli/update/install', () => ({ installUpdate }))
vi.mock('#sim-cli/update/check', () => ({ announceUpdateIfAvailable }))

import { buildProgram } from '#sim-cli/program'

beforeEach(() => {
  vi.clearAllMocks()
  installUpdate.mockResolvedValue(undefined)
  announceUpdateIfAvailable.mockResolvedValue(undefined)
})

describe('update command wiring', () => {
  it('runs a manual update without the daily check or authentication', async () => {
    await buildProgram().parseAsync(['node', 'sim', 'update'])
    expect(announceUpdateIfAvailable).not.toHaveBeenCalled()
    expect(installUpdate).toHaveBeenCalledExactlyOnceWith({ packageManager: undefined })
  })

  it('passes an explicit package manager to the updater', async () => {
    await buildProgram().parseAsync(['node', 'sim', 'update', '--package-manager', 'bun'])
    expect(installUpdate).toHaveBeenCalledExactlyOnceWith({ packageManager: 'bun' })
  })

  it('checks for a notice and continues the requested action without installing', async () => {
    const program = buildProgram()
    const action = vi.fn()
    program.commands.find((command) => command.name() === 'whoami')!.action(action)
    await program.parseAsync(['node', 'sim', 'whoami'])
    expect(announceUpdateIfAvailable).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledOnce()
    expect(installUpdate).not.toHaveBeenCalled()
  })

  it('propagates an explicit update failure', async () => {
    installUpdate.mockRejectedValueOnce(new Error('installation failed'))
    const program = buildProgram()
    await expect(program.parseAsync(['node', 'sim', 'update'])).rejects.toThrow(
      'installation failed'
    )
    expect(announceUpdateIfAvailable).not.toHaveBeenCalled()
  })
})
