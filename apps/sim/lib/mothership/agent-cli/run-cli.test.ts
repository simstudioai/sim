import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFile, writeFile, embedded } = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  embedded: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  readSessionSandboxFile: readFile,
  writeSessionSandboxFile: writeFile,
}))
vi.mock('sim/embed', () => ({ runEmbeddedCli: embedded }))

import { runCli } from '@/lib/mothership/agent-cli/run-cli'

const identity = { endpoint: 'https://sim.test', apiKey: 'test', workspaceId: 'workspace' }

describe('embedded CLI binary workbench bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves arbitrary bytes in both directions and binds both to the same chat', async () => {
    const bytes = Uint8Array.from([0, 255, 137, 80, 78, 71, 13, 10, 128, 195, 0])
    const stream = new Blob([bytes]).stream()
    readFile.mockResolvedValue({ outcome: 'read', content: Buffer.from(bytes).toString('base64') })
    writeFile.mockResolvedValue({ outcome: 'written', path: '/home/user/result.png' })
    embedded.mockImplementation(async (_args, _identity, options) => {
      expect(await options.readFile('image.png')).toEqual(Buffer.from(bytes))
      await expect(
        options.writeFile('result.png', stream, { overwrite: false })
      ).resolves.toBeUndefined()
      return { exitCode: 0, stdout: 'done', stderr: '' }
    })
    await runCli(['files', 'upload', '@image.png'], identity, 'mothership-chat:one')
    expect(readFile).toHaveBeenCalledWith('mothership-chat:one', 'image.png', 'base64', undefined)
    expect(writeFile).toHaveBeenCalledWith('mothership-chat:one', 'result.png', stream, undefined, {
      overwrite: false,
    })
  })

  it('does not provide host filesystem access when a chat has no workbench', async () => {
    embedded.mockImplementation(async (_args, _identity, options) => {
      expect(options.readFile).toBeUndefined()
      expect(options.writeFile).toBeUndefined()
      return { exitCode: 1, stdout: '', stderr: 'no machine' }
    })
    await runCli(['files', 'upload', '@/etc/passwd'], identity, null)
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('resolves equals-form file flags identically without reading escaped literals', async () => {
    readFile.mockResolvedValue({ outcome: 'read', content: Buffer.from('{}').toString('base64') })
    embedded.mockImplementation(async (_args, _identity, options) => {
      expect(await options.readFile('input.json')).toEqual(Buffer.from('{}'))
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await runCli(
      ['workflows', 'run', 'wf', '--input=@input.json', '--name=@@literal'],
      identity,
      'chat'
    )
    expect(readFile).toHaveBeenCalledExactlyOnceWith('chat', 'input.json', 'base64', undefined)
    expect(embedded).toHaveBeenCalledWith(
      expect.anything(),
      identity,
      expect.objectContaining({ readFile: expect.any(Function) })
    )
  })

  it('carries cancellation into file reads and refuses their result after Stop', async () => {
    const controller = new AbortController()
    readFile.mockImplementation(async (_session, _path, _encoding, signal) => {
      expect(signal).toBe(controller.signal)
      controller.abort(new Error('Stopped'))
      return { outcome: 'error', detail: 'Stopped' }
    })
    embedded.mockImplementation(async (_args, _identity, options) => {
      await options.readFile('input.csv')
      throw new Error('A cancelled read must not succeed')
    })
    await expect(
      runCli(['files', 'upload', '@input.csv'], { ...identity, signal: controller.signal }, 'chat')
    ).rejects.toThrow('Stopped')
    expect(readFile).toHaveBeenCalledTimes(1)
  })
})
