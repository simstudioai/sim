import { describe, expect, it } from 'vitest'
import { type ChipSelectOption, chipSelectOptionMatchesSearch } from './chip-select'

const GOOGLE_CLOUD_OPTION: ChipSelectOption = {
  label: 'Google Cloud CLI',
  value: 'google-cloud-cli',
  searchTerms: ['gcloud', 'bq', 'gsutil'],
}

describe('chipSelectOptionMatchesSearch', () => {
  it('matches labels with normalized casing and whitespace', () => {
    expect(chipSelectOptionMatchesSearch(GOOGLE_CLOUD_OPTION, '  CLOUD  ')).toBe(true)
  })

  it.each(['gcloud', 'bq', 'gsu'])('matches the search-only alias %s', (query) => {
    expect(chipSelectOptionMatchesSearch(GOOGLE_CLOUD_OPTION, query)).toBe(true)
  })

  it('normalizes whitespace and casing in search-only aliases', () => {
    expect(
      chipSelectOptionMatchesSearch(
        { label: 'Google Cloud CLI', value: 'google', searchTerms: ['  BIGQUERY  '] },
        'bigquery'
      )
    ).toBe(true)
  })

  it('does not expose unrelated options through another option alias', () => {
    expect(
      chipSelectOptionMatchesSearch(
        { label: 'GitHub CLI', value: 'github', searchTerms: ['gh'] },
        'bq'
      )
    ).toBe(false)
  })

  it('treats an empty normalized query as an unfiltered option list', () => {
    expect(chipSelectOptionMatchesSearch(GOOGLE_CLOUD_OPTION, '   ')).toBe(true)
  })
})
