import { describe, expect, it } from 'vitest'
import {
  type ConfluenceCreateCommentParams,
  confluenceCreateCommentTool,
} from '@/tools/confluence/create_comment'

function operationInput(parentCommentId: unknown) {
  return confluenceCreateCommentTool.operation.input({
    accessToken: 'token',
    domain: 'example.atlassian.net',
    pageId: '123',
    comment: 'Reply',
    parentCommentId,
  } as ConfluenceCreateCommentParams) as Record<string, unknown>
}

describe('confluence_create_comment operation input', () => {
  it.each([
    [456, '456'],
    [' 456 ', '456'],
    ['', undefined],
    [undefined, undefined],
  ])('normalizes parentCommentId %j to %j', (parentCommentId, expected) => {
    expect(operationInput(parentCommentId).parentCommentId).toBe(expected)
  })
})
