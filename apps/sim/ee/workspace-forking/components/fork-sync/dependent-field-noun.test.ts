/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { dependentFieldNoun } from '@/ee/workspace-forking/components/fork-sync/dependent-field-noun'

describe('dependentFieldNoun', () => {
  it('strips a leading imperative verb so copy does not stutter', () => {
    // The defect this exists to prevent: `Select ${title.toLowerCase()}` on a title that
    // already reads as an instruction rendered "Select select issue".
    expect(dependentFieldNoun('Select Issue')).toBe('issue')
    expect(dependentFieldNoun('Select Project')).toBe('project')
    expect(dependentFieldNoun('Choose Document')).toBe('document')
    expect(dependentFieldNoun('Pick a Table')).toBe('a table')
  })

  it('leaves a title that merely starts with those letters alone', () => {
    // The trailing `\s+` is what separates the verb from a word that begins with it.
    expect(dependentFieldNoun('Selected Files')).toBe('selected files')
    expect(dependentFieldNoun('Selection')).toBe('selection')
  })

  it('falls back to the whole title when stripping would leave nothing', () => {
    // A bare verb has no noun to extract; an empty result would render "Select " and
    // "No  found".
    expect(dependentFieldNoun('Select')).toBe('select')
    expect(dependentFieldNoun('Select   ')).toBe('select   ')
  })

  it('passes a plain noun through lowercased', () => {
    expect(dependentFieldNoun('Label')).toBe('label')
    expect(dependentFieldNoun('Conflict Column')).toBe('conflict column')
  })
})
