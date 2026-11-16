import { describe, expect, it } from 'vitest'
import { deleteFormTool } from '@/tools/typeform/delete_form'
import { responsesTool } from '@/tools/typeform/responses'
import type { TypeformResponsesParams } from '@/tools/typeform/types'

function responsesQuery(params: Partial<TypeformResponsesParams>): URLSearchParams {
  const buildUrl = responsesTool.request.url
  if (typeof buildUrl !== 'function') throw new Error('responses must build its URL')
  return new URL(buildUrl({ apiKey: 'k', formId: 'abc123', ...params })).searchParams
}

function deleteUrl(formId: string): string {
  const buildUrl = deleteFormTool.request.url
  if (typeof buildUrl !== 'function') throw new Error('delete_form must build its URL')
  return buildUrl({ apiKey: 'k', formId })
}

describe('Typeform request builders', () => {
  it('sends response types as response_type and drops the deprecated completed filter', () => {
    const query = responsesQuery({ responseType: 'partial,completed', completed: 'true' })

    expect(query.get('response_type')).toBe('partial,completed')
    expect(query.has('completed')).toBe(false)
  })

  it('joins response types a model sent as an array', () => {
    expect(responsesQuery({ responseType: ['partial', 'completed'] }).get('response_type')).toBe(
      'partial,completed'
    )
  })

  it('keeps the completed filter when no response type is given', () => {
    expect(responsesQuery({ completed: 'false' }).get('completed')).toBe('false')
  })

  it('refuses a form id that would redirect a delete to the responses endpoint', () => {
    expect(() => deleteUrl('abc123/responses?included_response_ids=r1')).toThrow(
      'formId cannot contain a path separator'
    )
  })
})
