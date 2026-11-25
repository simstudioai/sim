/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PlaceholderTokens } from '@/lib/workflows/dry-run/placeholders'

/** Tokens holding the placeholders of one answer: a row id, a title and an issue number. */
function registered() {
  const tokens = new PlaceholderTokens()
  tokens.register({
    row: { id: 'dry_run_row_1', data: { email: 'a@b.co' } },
    title: 'dry_run_title_2',
    number: 900_000_003,
    realId: 'row_8f3a2c',
    status: 200,
  })
  return tokens
}

describe('a dry run’s placeholder tokens', () => {
  it.each([
    ['whole', 'dry_run_row_1'],
    ['inside a path, after a word', '/files/file_dry_run_row_1.json'],
    ['followed by a word', 'dry_run_row_1_copy'],
    ['in another case', 'Row DRY_RUN_ROW_1 was archived'],
    ['quoted in free text', 'Re: dry_run_title_2'],
    ['as a number', 900_000_003],
    ['as digits in a URL', 'https://api.github.com/repos/o/r/issues/900000003'],
  ])('are found %s', (_, sent) => {
    expect(registered().occursIn({ sent })).toBe(true)
  })

  it.each([
    ['a longer token number', 'dry_run_row_10'],
    ['a real value the answer echoed', 'row_8f3a2c'],
    ['a number the answer did not mint', 200],
    ['digits that only start with a placeholder number', '9000000031'],
    ['a token no answer returned', 'dry_run_row_2'],
  ])('are not found in %s', (_, sent) => {
    expect(registered().occursIn({ sent })).toBe(false)
  })
})
