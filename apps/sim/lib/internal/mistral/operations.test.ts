/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { submit, authorizeFile, downloadFile, modelSafeFile } = vi.hoisted(() => ({
  submit: vi.fn(),
  authorizeFile: vi.fn(),
  downloadFile: vi.fn(),
  modelSafeFile: vi.fn(),
}))

vi.mock('@/lib/internal/mistral/client', () => ({ submitMistralOcr: submit }))
vi.mock('@/app/api/files/authorization', () => ({ assertToolFileAccess: authorizeFile }))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: downloadFile,
  resolveInternalFileUrl: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: modelSafeFile,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'Unsafe model input',
}))

import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import type { MistralParseInput } from '@/lib/internal/mistral/input'
import {
  executeMistralParse,
  type MistralOperationContext,
} from '@/lib/internal/mistral/operations'

describe('Mistral ingestion authorization', () => {
  const bytes = Buffer.from('Synthetic OCR fixture')
  const file = {
    key: 'ocr/fixture',
    name: 'fixture.png',
    type: 'image/png',
    size: bytes.length,
    base64: bytes.toString('base64'),
  }
  let input: MistralParseInput
  let context: MistralOperationContext

  beforeEach(() => {
    vi.clearAllMocks()
    submit.mockResolvedValue({ pages: [{ markdown: 'Synthetic OCR fixture' }] })
    authorizeFile.mockResolvedValue(new Response(null, { status: 404 }))
    modelSafeFile.mockResolvedValue(true)
    input = {
      apiKey: 'fixture-key',
      file: { ...file },
      [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
    }
    context = {
      headers: new Headers({
        [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      }),
      requestId: 'fixture-request',
      trustedCaller: 'knowledge-ingestion',
      deadlineAt: 123_456,
    }
  })

  it('accepts already-authorized inline bytes from the ingestion worker without a user session', async () => {
    await expect(executeMistralParse(input, context)).resolves.toMatchObject({ success: true })
    expect(submit).toHaveBeenCalledWith(
      'fixture-key',
      {
        model: 'mistral-ocr-latest',
        document: { type: 'image_url', image_url: `data:image/png;base64,${file.base64}` },
      },
      undefined,
      undefined,
      context.deadlineAt
    )
    expect(authorizeFile).not.toHaveBeenCalled()
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('refuses the same inline bytes from an unauthenticated tool caller', async () => {
    await expect(
      executeMistralParse(input, { ...context, trustedCaller: undefined })
    ).rejects.toMatchObject({ status: 401 })
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not let trusted ingestion bypass storage authorization for an unmaterialized file', async () => {
    input.file = { key: file.key, name: file.name, type: file.type, size: file.size }
    await expect(executeMistralParse(input, context)).rejects.toMatchObject({ status: 404 })
    expect(authorizeFile).toHaveBeenCalledWith(file.key, '', 'fixture-request', expect.any(Object))
    expect(downloadFile).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects incomplete provenance before sending trusted inline bytes to the model', async () => {
    input[RESOLVED_SECRET_PROVENANCE_FIELD] = { version: 1, complete: false, entries: [] }
    await expect(executeMistralParse(input, context)).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Model input provenance is unavailable' },
    })
    expect(submit).not.toHaveBeenCalled()
  })
})
