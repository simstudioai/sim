/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadCompiledDoc, mockRunSandboxTask, mockExecuteInSandbox, mockStoreCompiledDoc } =
  vi.hoisted(() => ({
    mockLoadCompiledDoc: vi.fn(),
    mockRunSandboxTask: vi.fn(),
    mockExecuteInSandbox: vi.fn(),
    mockStoreCompiledDoc: vi.fn(),
  }))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  executeInSandbox: mockExecuteInSandbox,
  executeShellInSandbox: vi.fn(),
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
  storeCompiledDoc: mockStoreCompiledDoc,
}))
vi.mock('@/app/api/files/utils', () => ({
  getContentType: (name: string) =>
    name.endsWith('.pdf')
      ? 'application/pdf'
      : name.endsWith('.txt')
        ? 'text/plain'
        : 'application/octet-stream',
}))

import { resolveServableDocBytes } from './doc-compile'

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000'
const PDF_MAGIC = Buffer.from('%PDF-1.7\n...binary...')
const PDF_SOURCE = Buffer.from('from reportlab.pdfgen import canvas\n# generates a PDF', 'utf-8')
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])
const XLSX_SOURCE = Buffer.from('from openpyxl import Workbook\n# generates an xlsx', 'utf-8')

/**
 * The compiled-artifact and failed-render caches are module-level and keyed by
 * (ext, source, workspaceId), so tests that reuse a source would read each other's
 * entries instead of exercising the path under test.
 */
let sourceCounter = 0
function uniqueSource(content: string): Buffer {
  sourceCounter += 1
  return Buffer.from(`${content}\n# unique-${sourceCounter}`, 'utf-8')
}

afterAll(resetEnvFlagsMock)

describe('resolveServableDocBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isDocSandboxEnabled: true })
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

  it('renders and stores the artifact when it is missing, instead of reporting not-ready', async () => {
    // An artifact miss is not evidence a compile is in flight: the key is
    // (workspace, source hash), so a forked workspace, a moved file, or a source
    // edited outside a recompiling writer all miss permanently. Rendering here is
    // what keeps those from becoming a retry-forever dead end.
    const source = uniqueSource('render-on-read')
    mockLoadCompiledDoc.mockResolvedValue(null)
    mockExecuteInSandbox.mockResolvedValue({
      exportedFileContent: Buffer.from('%PDF-rendered-on-read').toString('base64'),
    })

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer.toString()).toBe('%PDF-rendered-on-read')
    expect(result.contentType).toBe('application/pdf')
    expect(mockStoreCompiledDoc).toHaveBeenCalledTimes(1)
  })

  it('serves the stored bytes as opaque data when they cannot be rendered', async () => {
    // A .pdf-named file that is neither a real PDF nor renderable source (an HTML
    // error page, a renamed legacy format) must not fail forever — and must not be
    // handed back labelled application/pdf.
    const notReallyAPdf = uniqueSource('<html>503 Service Unavailable</html>')
    mockLoadCompiledDoc.mockResolvedValue(null)
    mockExecuteInSandbox.mockResolvedValue({ error: 'SyntaxError: invalid syntax' })

    const result = await resolveServableDocBytes({
      rawBuffer: notReallyAPdf,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(notReallyAPdf)
    expect(result.contentType).toBe('application/octet-stream')
  })

  it('does not re-run the sandbox for bytes that already failed to render', async () => {
    const notReallyAPdf = uniqueSource('<html>still not a pdf</html>')
    mockLoadCompiledDoc.mockResolvedValue(null)
    mockExecuteInSandbox.mockResolvedValue({ error: 'SyntaxError: invalid syntax' })

    const args = {
      rawBuffer: notReallyAPdf,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    }
    await resolveServableDocBytes(args)
    const second = await resolveServableDocBytes(args)

    expect(mockExecuteInSandbox).toHaveBeenCalledTimes(1)
    expect(second.buffer).toBe(notReallyAPdf)
    expect(second.contentType).toBe('application/octet-stream')
  })

  it('compiles via the sandbox when E2B is disabled and no artifact is stored', async () => {
    const source = uniqueSource('from reportlab.pdfgen import canvas')
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: false })
    const compiled = Buffer.from('%PDF-isolated-vm-binary')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(compiled)
    expect(result.contentType).toBe('application/pdf')
    expect(mockRunSandboxTask).toHaveBeenCalledWith(
      'pdf-generate',
      { code: source.toString('utf-8'), workspaceId: WORKSPACE_ID },
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

  it('passes through a real binary XLSX (ZIP magic) without an artifact lookup', async () => {
    const result = await resolveServableDocBytes({
      rawBuffer: ZIP_MAGIC,
      fileName: 'sheet.xlsx',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(ZIP_MAGIC)
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('renders a generated XLSX on read when its artifact is missing (E2B enabled)', async () => {
    const source = uniqueSource('from openpyxl import Workbook')
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: true })
    mockExecuteInSandbox.mockResolvedValue({
      exportedFileContent: Buffer.from('PK-rendered-xlsx').toString('base64'),
    })

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'sheet.xlsx',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer.toString()).toBe('PK-rendered-xlsx')
    // xlsx has no isolated-vm path, so this must have come from the E2B engine.
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('returns raw XLSX source when there is no workspaceId (xlsx has no isolated-vm path)', async () => {
    const result = await resolveServableDocBytes({
      rawBuffer: XLSX_SOURCE,
      fileName: 'sheet.xlsx',
      workspaceId: undefined,
    })

    expect(result.buffer).toBe(XLSX_SOURCE)
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('does not let a negative isGeneratedSource short-circuit the workspace branch', async () => {
    // Regression guard: `isGeneratedSource` derives from UserFile.type, which workflow
    // state can rewrite. A generated doc whose marker was overwritten must still be
    // rendered rather than served as its own raw source — the corruption this module
    // exists to prevent. With a workspace context, the bytes decide, not the type.
    const source = uniqueSource('from reportlab.pdfgen import canvas')
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: true })
    mockExecuteInSandbox.mockResolvedValue({
      exportedFileContent: Buffer.from('%PDF-rendered-despite-flag').toString('base64'),
    })

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
      isGeneratedSource: false,
    })

    expect(result.buffer.toString()).toBe('%PDF-rendered-despite-flag')
    expect(result.contentType).toBe('application/pdf')
  })

  it('serves the compiled artifact even when the type says the file is not generated', async () => {
    // The same rewritten-marker case, but with the artifact present: the content-hash
    // lookup is authoritative and rescues the file regardless of the declared type.
    const compiled = Buffer.from('%PDF-1.7 compiled')
    mockLoadCompiledDoc.mockResolvedValue(compiled)
    setEnvFlags({ isDocSandboxEnabled: true })

    const result = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
      isGeneratedSource: false,
    })

    expect(result.buffer).toBe(compiled)
  })

  it('recovers a forked workspace copy whose artifact was never copied with it', async () => {
    // Forking copies the source blob under a new workspace/<childId>/ key, but the
    // artifact store is keyed by workspace, so every generated doc in the child misses.
    // This used to be a permanent "still being generated" for a perfectly good file.
    const source = uniqueSource('from reportlab.pdfgen import canvas')
    const CHILD_WORKSPACE_ID = '660e8400-e29b-41d4-a716-446655440111'
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: true })
    mockExecuteInSandbox.mockResolvedValue({
      exportedFileContent: Buffer.from('%PDF-rendered-in-fork').toString('base64'),
    })

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: CHILD_WORKSPACE_ID,
      isGeneratedSource: true,
    })

    expect(result.buffer.toString()).toBe('%PDF-rendered-in-fork')
    expect(mockStoreCompiledDoc).toHaveBeenCalledTimes(1)
  })

  it('does not run unverified bytes as a program when no workspaceId can vouch for them', async () => {
    // Execution-scratch keys yield no workspaceId, so neither the artifact lookup nor
    // the not-ready guard can run. Without positive evidence the bytes are generation
    // source, the only remaining branch would hand arbitrary content to the sandbox.
    setEnvFlags({ isDocSandboxEnabled: true })
    const fetchedBytes = Buffer.from('<html>not a pdf at all</html>', 'utf-8')

    const result = await resolveServableDocBytes({
      rawBuffer: fetchedBytes,
      fileName: 'report.pdf',
      workspaceId: undefined,
      isGeneratedSource: false,
    })

    expect(result.buffer).toBe(fetchedBytes)
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('treats an unknown type as not-generated for execution, but still compiles a known source', async () => {
    setEnvFlags({ isDocSandboxEnabled: false })
    const compiled = Buffer.from('%PDF-isolated-vm-binary')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const unknownType = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: undefined,
    })
    expect(unknownType.buffer).toBe(PDF_SOURCE)
    expect(mockRunSandboxTask).not.toHaveBeenCalled()

    const knownSource = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: undefined,
      isGeneratedSource: true,
    })
    expect(knownSource.buffer).toBe(compiled)
    expect(mockRunSandboxTask).toHaveBeenCalledTimes(1)
  })

  it('compiles a marked source without a workspace id even while E2B is the active regime', async () => {
    // The E2B not-ready guard lives behind the workspace branch, so with no workspace
    // context a marked source reaches the isolated-vm task regardless of the flag.
    // Pinned because the two regimes otherwise look interchangeable from the outside.
    setEnvFlags({ isDocSandboxEnabled: true })
    // Distinct source per test: compiledDocCache is module-level and keyed by
    // (ext, source, workspaceId), so reusing PDF_SOURCE would serve an earlier test's
    // cached buffer and never reach the sandbox at all.
    const source = Buffer.from('from reportlab import x  # e2b-regime-no-workspace', 'utf-8')
    const compiled = Buffer.from('%PDF-e2b-regime-no-workspace')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: undefined,
      isGeneratedSource: true,
    })

    expect(result.buffer).toBe(compiled)
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('still compiles in the isolated-vm regime when the declared type is not a marker', async () => {
    // E2B disabled means no artifact store, so compile-on-read is the only path to a
    // binary. A negative flag must not skip it — that would serve source.
    setEnvFlags({ isDocSandboxEnabled: false })
    mockLoadCompiledDoc.mockResolvedValue(null)
    const source = Buffer.from('from reportlab import x  # isolated-vm-negative-flag', 'utf-8')
    const compiled = Buffer.from('%PDF-isolated-vm-negative-flag')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
      isGeneratedSource: false,
    })

    expect(result.buffer).toBe(compiled)
  })
})
