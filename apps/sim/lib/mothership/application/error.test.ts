/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE,
  messageForCopilotApplicationError,
} from '@/lib/mothership/application/error'

describe('Copilot application error projection', () => {
  it('exposes only non-internal application errors', () => {
    expect(
      messageForCopilotApplicationError(new OrchestrationError('conflict', 'Name already exists'))
    ).toBe('Name already exists')
  })

  it('projects internal and unknown infrastructure failures to a generic retryable message', () => {
    expect(
      messageForCopilotApplicationError(
        new OrchestrationError('internal', 'select secret_column from workspace_files')
      )
    ).toBe(COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE)
    expect(messageForCopilotApplicationError(new Error('storage bucket credential rejected'))).toBe(
      COPILOT_APPLICATION_SYSTEM_ERROR_MESSAGE
    )
  })

  it('supports a caller-defined safe fallback without exposing the cause', () => {
    expect(
      messageForCopilotApplicationError(
        new Error('update workspace_files set content = raw'),
        'File operation failed. Please retry.'
      )
    ).toBe('File operation failed. Please retry.')
  })
})
