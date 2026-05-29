/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// xlsx generation is gated behind the mothership beta flag; flip this to assert
// both regimes (getE2BDocFormat reads the flag at call time).
const flags = vi.hoisted(() => ({ beta: false }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isMothershipBetaFeaturesEnabled() {
    return flags.beta
  },
}))
vi.mock('@/lib/execution/e2b', () => ({ executeInE2B: vi.fn(), executeShellInE2B: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: vi.fn(),
  fetchWorkspaceFileBuffer: vi.fn(),
}))
vi.mock('./doc-compiled-store', () => ({
  loadCompiledDoc: vi.fn(),
  storeCompiledDoc: vi.fn(),
}))

import { getE2BDocFormat, PYTHON_PDF_SOURCE_MIME, PYTHON_XLSX_SOURCE_MIME } from './doc-compile'

describe('getE2BDocFormat', () => {
  it('routes pptx/docx to the node engine, pdf to python', () => {
    flags.beta = false
    expect(getE2BDocFormat('deck.pptx')?.engine).toBe('node')
    expect(getE2BDocFormat('report.docx')?.engine).toBe('node')
    const pdf = getE2BDocFormat('out.pdf')
    expect(pdf?.engine).toBe('python')
    expect(pdf?.sourceMime).toBe(PYTHON_PDF_SOURCE_MIME)
    expect(getE2BDocFormat('report.PDF')?.ext).toBe('pdf')
  })

  it('gates xlsx behind the mothership beta flag', () => {
    flags.beta = false
    expect(getE2BDocFormat('budget.xlsx')).toBeNull()
    flags.beta = true
    const xlsx = getE2BDocFormat('budget.xlsx')
    expect(xlsx?.engine).toBe('python')
    expect(xlsx?.sourceMime).toBe(PYTHON_XLSX_SOURCE_MIME)
    flags.beta = false
  })

  it('returns null for non-document files', () => {
    expect(getE2BDocFormat('notes.md')).toBeNull()
    expect(getE2BDocFormat('script.py')).toBeNull()
  })
})
