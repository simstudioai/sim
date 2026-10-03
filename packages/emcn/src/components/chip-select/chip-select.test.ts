import { describe, expect, it } from 'vitest'
import { type ChipSelectOption, chipSelectOptionMatchesSearch } from './chip-select'

const _GOOGLE_CLOUD_OPTION: ChipSelectOption = {
  label: 'Google Cloud CLI',
  value: 'google-cloud-cli',
  searchTerms: ['gcloud', 'bq', 'gsutil'],
}

describe('chipSelectOptionMatchesSearch', () => {
  it('does not expose unrelated options through another option alias', () => {
    expect(
      chipSelectOptionMatchesSearch(
        { label: 'GitHub CLI', value: 'github', searchTerms: ['gh'] },
        'bq'
      )
    ).toBe(false)
  })
})
