/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { e2bFlag, mockLoadCompiledDoc, mockRunSandboxTask } = vi.hoisted(() => ({
  e2bFlag: { value: true },
  mockLoadCompiledDoc: vi.fn(),
  mockRunSandboxTask: vi.fn(),
}))

vi.mock('@/lib/execution/e2b', () => ({
  executeInE2B: vi.fn(),
  executeShellInE2B: vi.fn(),
}))
vi.mock('@/lib/execution/languages', () => ({
  CodeLanguage: { javascript: 'javascript', python: 'python' },
}))
vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: mockRunSandboxTask,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: vi.fn(),
  fetchWorkspaceFileBuffer: vi.fn(),
}))
vi.mock('./doc-compiled-store', () => ({
  loadCompiledDoc: mockLoadCompiledDoc,
  storeCompiledDoc: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isE2BDocEnabled() {
    return e2bFlag.value
  },
}))
vi.mock('@/app/api/files/utils', () => ({
  getContentType: (name: string) =>
    name.endsWith('.pdf')
      ? 'application/pdf'
      : name.endsWith('.txt')
        ? 'text/plain'
        : 'application/octet-stream',
}))

import { DocCompileUserError, resolveServableDocBytes } from './doc-compile'

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000'
const PDF_MAGIC = Buffer.from('%PDF-1.7\n...binary...')
const PDF_SOURCE = Buffer.from('from reportlab.pdfgen import canvas\n# generates a PDF', 'utf-8')

describe('resolveServableDocBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    e2bFlag.value = true
  })

  it('swaps generated-doc source for the compiled artifact + binary content type', async () => {
    const artifact = Buffer.from('%PDF-compiled-binary')
    mockLoadCompiledDoc.mockResolvedValue(artifact)

    const result = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(artifact)
    expect(result.contentType).toBe('application/pdf')
    expect(mockLoadCompiledDoc).toHaveBeenCalledWith(
      WORKSPACE_ID,
      PDF_SOURCE.toString('utf-8'),
      'pdf'
    )
  })

  it('passes through a real binary PDF (carries the %PDF magic) without an artifact lookup', async () => {
    const result = await resolveServableDocBytes({
      rawBuffer: PDF_MAGIC,
      fileName: 'uploaded.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(PDF_MAGIC)
    expect(result.contentType).toBe('application/pdf')
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('throws DocCompileUserError when a generated doc artifact is not ready (E2B regime)', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    e2bFlag.value = true

    await expect(
      resolveServableDocBytes({
        rawBuffer: PDF_SOURCE,
        fileName: 'report.pdf',
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toBeInstanceOf(DocCompileUserError)

    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('compiles via the sandbox when E2B is disabled and no artifact is stored', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    e2bFlag.value = false
    const compiled = Buffer.from('%PDF-isolated-vm-binary')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const result = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(compiled)
    expect(result.contentType).toBe('application/pdf')
    expect(mockRunSandboxTask).toHaveBeenCalledWith(
      'pdf-generate',
      { code: PDF_SOURCE.toString('utf-8'), workspaceId: WORKSPACE_ID },
      expect.objectContaining({})
    )
  })

  it('passes non-doc files through untouched with their extension content type', async () => {
    const text = Buffer.from('hello world', 'utf-8')
    const result = await resolveServableDocBytes({
      rawBuffer: text,
      fileName: 'notes.txt',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(text)
    expect(result.contentType).toBe('text/plain')
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })
})
