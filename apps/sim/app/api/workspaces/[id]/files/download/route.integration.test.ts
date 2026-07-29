/**
 * @vitest-environment node
 *
 * Exercises the real archive plumbing — archiver, the lazy entry generator, and the
 * Node-to-web bridge — against multi-chunk file streams, and validates the result with
 * the operating system's `unzip` rather than the same JS library that produced it. The
 * bug this route exists to fix was an archive a real zip reader could not open, so a
 * self-consistent JS round-trip is not the assertion that matters.
 */
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createMockRequest } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const run = promisify(execFile)

const {
  mockGetSession,
  mockVerifyWorkspaceMembership,
  mockListWorkspaceFiles,
  mockListFolders,
  mockDownloadFileStream,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockListFolders: vi.fn(),
  mockDownloadFileStream: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: mockVerifyWorkspaceMembership,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: mockListWorkspaceFiles,
  listWorkspaceFileFolders: mockListFolders,
  buildWorkspaceFileFolderPathMap: (folders: Array<{ id: string; name: string }>) =>
    new Map(folders.map((folder) => [folder.id, folder.name])),
  fetchServableWorkspaceFileBuffer: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mockDownloadFileStream,
}))
vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { GET } from '@/app/api/workspaces/[id]/files/download/route'

const WORKSPACE_ID = 'ws-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

let workDir: string
let bigPath: string
let bigBytes: Buffer
/** The OS unzip is the point of this file; skip rather than fail where it is absent. */
let hasUnzip = true

beforeAll(async () => {
  hasUnzip = await run('unzip', ['-v']).then(
    () => true,
    () => false
  )
  workDir = await mkdtemp(join(tmpdir(), 'sim-archive-'))
  bigPath = join(workDir, 'big.bin')
  // Several MB of non-repeating bytes: forces many 64 KiB chunks through the generator,
  // the archiver queue and the web bridge, and would expose a truncation or ordering bug.
  bigBytes = Buffer.alloc(5 * 1024 * 1024)
  for (let i = 0; i < bigBytes.length; i++) bigBytes[i] = (i * 31 + (i >> 8)) & 0xff
  await writeFile(bigPath, bigBytes)
})

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('workspace files download — real archive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyWorkspaceMembership.mockResolvedValue({ role: 'member' })
    mockListFolders.mockResolvedValue([{ id: 'folder-1', name: 'Reports', parentId: null }])
    // A real fs stream, not a single pre-made buffer.
    mockDownloadFileStream.mockImplementation(async () => createReadStream(bigPath))
  })

  it('produces an archive the OS unzip accepts, with byte-exact contents', async (ctx) => {
    if (!hasUnzip) ctx.skip()
    mockListWorkspaceFiles.mockResolvedValue([
      {
        id: 'f1',
        name: 'big.bin',
        key: `workspace/${WORKSPACE_ID}/f1`,
        path: '/serve/f1',
        size: bigBytes.length,
        type: 'application/octet-stream',
        folderId: 'folder-1',
      },
    ])

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/download?fileIds=f1`
      ),
      context
    )
    expect(response.status).toBe(200)

    const zipPath = join(workDir, 'out.zip')
    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))

    // Independent validation: the CRCs and central directory have to satisfy a real
    // zip reader, which is exactly what failed for the customer.
    await expect(run('unzip', ['-t', zipPath])).resolves.toBeTruthy()

    await run('unzip', ['-o', '-q', zipPath, '-d', join(workDir, 'out')])
    const extracted = await readFile(join(workDir, 'out', 'Reports', 'big.bin'))
    expect(extracted.length).toBe(bigBytes.length)
    expect(extracted.equals(bigBytes)).toBe(true)
  })

  it('keeps entries intact and correctly named across several streamed files', async (ctx) => {
    if (!hasUnzip) ctx.skip()
    mockListWorkspaceFiles.mockResolvedValue(
      ['a.bin', 'b.bin', 'c.bin'].map((name, index) => ({
        id: `f${index}`,
        name,
        key: `workspace/${WORKSPACE_ID}/f${index}`,
        path: `/serve/f${index}`,
        size: bigBytes.length,
        type: 'application/octet-stream',
        folderId: 'folder-1',
      }))
    )

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/download?fileIds=f0&fileIds=f1&fileIds=f2`
      ),
      context
    )

    const zipPath = join(workDir, 'multi.zip')
    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))
    await expect(run('unzip', ['-t', zipPath])).resolves.toBeTruthy()

    const { stdout } = await run('unzip', ['-l', zipPath])
    for (const name of ['Reports/a.bin', 'Reports/b.bin', 'Reports/c.bin']) {
      expect(stdout).toContain(name)
    }
    // Each entry carries the full payload — a shared or truncated stream would not.
    expect(stdout.match(/5242880/g)).toHaveLength(3)
  })
})
