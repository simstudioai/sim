/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { StorageLimitExceededError } from '@/lib/billing/storage'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ArchiveError } from '@/lib/uploads/archive'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api/internal-error-policies'
import {
  CompiledCheckTooLargeError,
  CompiledCheckUnsupportedError,
} from '@/lib/workspace-files/application/compiled-check-workspace-file'
import { StyleExtractionUnsupportedError } from '@/lib/workspace-files/application/style-workspace-file'

describe('internal file error policies', () => {
  it('projects style and compiled-check failures without constructing responses', () => {
    expect(
      internalFileErrorPolicies.style.project(new StyleExtractionUnsupportedError('Unsupported'))
    ).toEqual({ status: 422, body: { error: 'Unsupported' }, headers: undefined })
    expect(
      internalFileErrorPolicies.compiledCheck.project(new CompiledCheckUnsupportedError())
    ).toMatchObject({ status: 422 })
    expect(
      internalFileErrorPolicies.compiledCheck.project(new CompiledCheckTooLargeError())
    ).toMatchObject({ status: 413 })
  })

  it('conceals forbidden inline resources with the legacy not-found envelope', () => {
    expect(
      internalFileErrorPolicies.inline.project(new OrchestrationError('forbidden', 'Forbidden'))
    ).toEqual({
      status: 404,
      body: { error: 'FileNotFoundError', message: 'Not found' },
      headers: undefined,
    })
  })

  it('preserves the legacy payment-required status for storage quota failures', () => {
    expect(
      internalFileErrorPolicies.content.project(
        new StorageLimitExceededError('Storage limit exceeded')
      )
    ).toEqual({
      status: 402,
      body: { error: 'Storage limit exceeded' },
      headers: undefined,
    })
  })

  it('maps archive extraction failures onto caller-safe statuses', () => {
    expect(
      internalFileErrorPolicies.extractArchive.project(
        new ArchiveError('invalid', 'Not a valid .zip archive.')
      )
    ).toEqual({
      status: 400,
      body: { error: 'Not a valid .zip archive.' },
      headers: undefined,
    })
    expect(
      internalFileErrorPolicies.extractArchive.project(
        new ArchiveError('too_many_entries', 'Archive has 1001 files; the maximum is 1000.')
      )
    ).toEqual({
      status: 413,
      body: { error: 'Archive has 1001 files; the maximum is 1000.' },
      headers: undefined,
    })
  })
})
