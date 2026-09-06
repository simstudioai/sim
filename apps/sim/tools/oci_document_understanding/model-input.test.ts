/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ociDocumentAnalyzeDocumentTool } from '@/tools/oci_document_understanding/analyze_document'
import { ociDocumentCreateProcessorJobTool } from '@/tools/oci_document_understanding/create_processor_job'

const file = {
  id: 'file-1',
  key: 'workspace/workspace-1/file-1',
  name: 'private-name.pdf',
  url: 'https://storage.example/document.pdf?signature=private',
  size: 42,
  type: 'application/pdf',
}

describe('document model input and submission identity', () => {
  it.each([ociDocumentAnalyzeDocumentTool, ociDocumentCreateProcessorJobTool])(
    '%s keeps file locators and credential material out of opaque byte provenance',
    (tool) => {
      const modelInput = tool.operation.modelInput
      if (modelInput?.mode !== 'private-provenance') throw new Error('Expected private provenance')
      expect(
        modelInput.inputPaths({ oauthCredential: 'visible', accessToken: 'authorized', file })
      ).toEqual([])
      expect(
        modelInput.inputPaths({
          oauthCredential: 'visible',
          file: { ...file, base64: 'private-bytes' },
        })
      ).toEqual([['file', 'base64']])
    }
  )

  it('keeps a submission token stable across retries and distinct across loop invocations', () => {
    const params = {
      oauthCredential: 'visible',
      accessToken: 'authorized',
      _context: { executionId: 'execution-1', blockId: 'block-1', invocationId: '1' },
    }
    const build = ociDocumentCreateProcessorJobTool.operation.input
    const first = build(params)
    expect(build(params)).toEqual(first)
    expect(first.retryToken).toMatch(/^sim_[A-Za-z0-9_-]{32}$/)
    expect(
      build({ ...params, _context: { ...params._context, invocationId: '2' } }).retryToken
    ).not.toBe(first.retryToken)
    expect(build({ ...params, retryToken: 'explicit-token' }).retryToken).toBe('explicit-token')
    expect(
      build({ ...params, _context: { executionId: 'execution-1' } }).retryToken
    ).toBeUndefined()
    expect(first).not.toHaveProperty('_context')
  })
})
