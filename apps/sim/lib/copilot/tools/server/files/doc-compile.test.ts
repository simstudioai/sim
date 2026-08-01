/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/execution/remote-sandbox', () => ({
  executeInSandbox: vi.fn(),
  executeShellInSandbox: vi.fn(),
}))
vi.mock('@/lib/execution/languages', () => ({
  CodeLanguage: { javascript: 'javascript', python: 'python' },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: vi.fn(),
  fetchWorkspaceFileBuffer: vi.fn(),
}))
vi.mock('./doc-compiled-store', () => ({
  loadCompiledDoc: vi.fn(),
  storeCompiledDoc: vi.fn(),
}))

import { collectReferencedFileIds } from './doc-compile'

const ID = '550e8400-e29b-41d4-a716-446655440000'

describe('collectReferencedFileIds', () => {
  it('captures the id from getFileBase64(...) with single or double quotes', () => {
    expect(collectReferencedFileIds(`await getFileBase64('${ID}')`)).toEqual(new Set([ID]))
    expect(collectReferencedFileIds(`getFileBase64("abc_def-1")`)).toEqual(new Set(['abc_def-1']))
  })

  it('captures the id from pptx addImage(slide, id, opts) (second arg)', () => {
    const src = `await addImage(slide, '${ID}', { x: 1, y: 1, w: 2, h: 2 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set([ID]))
  })

  it('captures the id from docx addImage(id, opts) (first arg)', () => {
    const src = `const img = await addImage('docx-img-1', { width: 200, height: 100 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set(['docx-img-1']))
  })

  it('captures the id from pdf drawImage(page, id, opts) (second arg)', () => {
    const src = `await drawImage(page, 'pdf-img-2', { x: 0, y: 0, width: 100, height: 100 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set(['pdf-img-2']))
  })

  it('still supports the legacy /home/user/inputs/<id> path form', () => {
    expect(collectReferencedFileIds(`fs.readFileSync('/home/user/inputs/legacy-1')`)).toEqual(
      new Set(['legacy-1'])
    )
  })

  it('collects and dedupes ids across multiple call sites', () => {
    const src = `
      await addImage(slide, 'logo-1', { x: 0, y: 0, w: 1, h: 1 });
      const uri = await getFileBase64('logo-1');
      await addImage(slide, 'crest-2', { x: 2, y: 0, w: 1, h: 1 });
    `
    expect(collectReferencedFileIds(src)).toEqual(new Set(['logo-1', 'crest-2']))
  })

  it('does not match id-like strings outside the image helpers', () => {
    const src = `slide.addText('order ${ID} shipped', { x: 1, y: 1, w: 8, h: 1 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set())
  })

  it('does not match slide.addImage({ data }) — no fileId is present there', () => {
    const src = `slide.addImage({ data: base64Data, x: 1, y: 1, w: 2, h: 2 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set())
  })

  it('returns an empty set when there are no image references', () => {
    expect(collectReferencedFileIds(`slide.addText('hello', { x: 1, y: 1 })`)).toEqual(new Set())
  })
})
