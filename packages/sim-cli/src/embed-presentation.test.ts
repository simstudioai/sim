import chalk from 'chalk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from '#cli/embed'
import { embedStore } from '#cli/embed-context'
import { EmbeddedOutput } from '#cli/embed-output'
import type { ListFilesResponse } from '#cli/generated/v2-api'
import { bool, bytes, duration, text, timestamp } from '#cli/output/render'

const IDENTITY = {
  endpoint: 'https://sim.test',
  apiKey: 'test',
  workspaceId: 'workspace',
}
const FILE: ListFilesResponse['data'][number] = {
  id: 'build-log',
  webUrl: 'https://sim.test/file/build-log',
  name: 'build.log',
  size: 42,
  type: 'text/plain',
  key: 'workspace/build.log',
  folderPath: '/',
  uploadedByEmail: 'user@example.test',
  uploadedAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  deletedAt: null,
}
const originalLevel = chalk.level
const originalTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chalk.level = 1
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true })
})

afterEach(() => {
  chalk.level = originalLevel
  if (originalTTY) Object.defineProperty(process.stderr, 'isTTY', originalTTY)
  else Reflect.deleteProperty(process.stderr, 'isTTY')
})

describe('embedded presentation on a terminal host', () => {
  it('keeps parallel raw file bytes and plain CLI notes separate without changing host styling', async () => {
    const content = 'build started\r\n\u001b[31mfailed\u001b[0m\tjob=compile\n'
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready = () => {}
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const transport = vi.fn(async () => {
      ready()
      await gate
      return new Response(content, { headers: { 'content-type': 'text/plain' } })
    })
    const file = runEmbeddedCli(['files', 'get', FILE.id], { ...IDENTITY, transport })
    try {
      await started
      expect(bool(true)).toBe('\u001b[32myes\u001b[39m')
      const list = await runEmbeddedCli(['files', 'list', '--limit', '1'], {
        ...IDENTITY,
        transport: async () =>
          json({ data: [FILE], nextCursor: 'next' } satisfies ListFilesResponse),
      })
      expect(list.exitCode, list.stderr).toBe(0)
      expect(JSON.parse(list.stdout)).toEqual([FILE])
      expect(list.stderr).toBe(
        'showing the first 1; more results exist — re-run with --limit 0 for all\n'
      )
      expect(bool(true)).toBe('\u001b[32myes\u001b[39m')
      expect(chalk.level).toBe(1)
    } finally {
      release()
      await file
    }
    expect(await file).toEqual({ exitCode: 0, stdout: content, stderr: '' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('does not capture terminal progress while paging through a complete inventory', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [FILE], nextCursor: 'next' } satisfies ListFilesResponse))
      .mockResolvedValueOnce(
        json({ data: [{ ...FILE, id: 'other' }], nextCursor: null } satisfies ListFilesResponse)
      )
    const result = await runEmbeddedCli(['files', 'list', '--limit', '0'], {
      ...IDENTITY,
      transport,
    })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([FILE, { ...FILE, id: 'other' }])
    expect(result.stderr).toBe('')
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('formats cells in their invocation context even when initialized on a color terminal', () => {
    embedStore.run(
      { identity: IDENTITY, stdout: new EmbeddedOutput(), stderr: new EmbeddedOutput() },
      () => {
        expect([text(null), bool(null), bytes(null), duration(null), timestamp(null)]).toEqual(
          Array(5).fill('—')
        )
        expect(bool(true)).toBe('yes')
        expect(bool(false)).toBe('no')
      }
    )
    expect(bool(true)).toBe('\u001b[32myes\u001b[39m')
  })
})
