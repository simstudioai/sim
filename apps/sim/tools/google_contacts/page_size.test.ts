/**
 * @vitest-environment node
 *
 * `pageSize` is a single subBlock shared by two operations with different
 * ceilings: `people.connections.list` accepts 1–1000 (default 100), while
 * `people:searchContacts` caps anything above 30 to 30 (default 10). A user who
 * follows a list-sized number into a search would silently get 30 results back
 * for a request that asked for more, so the block clamps per operation.
 * @see https://developers.google.com/people/api/rest/v1/people.connections/list
 * @see https://developers.google.com/people/api/rest/v1/people/searchContacts
 */
import { describe, expect, it } from 'vitest'
import { GoogleContactsBlock } from '@/blocks/blocks/google_contacts'

function resolveParams(operation: string, pageSize?: unknown): Record<string, any> {
  return (GoogleContactsBlock.tools.config!.params as (p: any) => Record<string, any>)({
    operation,
    oauthCredential: 'cred',
    ...(pageSize === undefined ? {} : { pageSize }),
  })
}

describe('google_contacts pageSize clamping', () => {
  it('clamps a list-sized page size down to the search ceiling', () => {
    expect(resolveParams('search', '100').pageSize).toBe(30)
  })

  it('keeps a list page size up to the list ceiling', () => {
    expect(resolveParams('list', '100').pageSize).toBe(100)
    expect(resolveParams('list', '1000').pageSize).toBe(1000)
  })

  it('clamps above the list ceiling', () => {
    expect(resolveParams('list', '5000').pageSize).toBe(1000)
  })

  it('clamps zero and negatives up to the minimum of 1', () => {
    expect(resolveParams('list', '0').pageSize).toBe(1)
    expect(resolveParams('search', '-5').pageSize).toBe(1)
  })

  it('coerces the string a block input produces into a number', () => {
    expect(resolveParams('search', '12').pageSize).toBe(12)
    expect(resolveParams('search', 12).pageSize).toBe(12)
  })

  it('drops an unparseable page size instead of forwarding NaN', () => {
    expect(resolveParams('list', 'abc').pageSize).toBeUndefined()
    expect(resolveParams('list', '').pageSize).toBeUndefined()
  })

  it('leaves operations without a page size untouched', () => {
    expect(resolveParams('get')).not.toHaveProperty('pageSize')
    expect(resolveParams('create', '100').pageSize).toBe('100')
  })
})
