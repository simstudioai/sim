import { describe, expect, it } from 'vitest'
import { CrunchbaseBlock } from '@/blocks/blocks/crunchbase'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('CrunchbaseBlock', () => {
  const buildParams = CrunchbaseBlock.tools.config!.params!

  const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

  /*
   * The mapper's whole job is dropping keys that belong to another operation.
   * `shouldSerializeSubBlock` short-circuits on `mode: 'advanced'` before it
   * evaluates a condition, so a hidden advanced field still reaches `inputs` —
   * only an explicit `undefined` removes it from what goes out on the wire.
   */
  it('drops a previous operation’s leftovers when the operation changes', () => {
    const params = resolve({
      operation: 'autocomplete',
      apiKey: 'key',
      autocompleteQuery: 'airbnb',
      searchQuery: '[{"type":"predicate","field_id":"categories"}]',
      searchFieldIds: '["identifier"]',
      entityId: 'tesla-motors',
      fieldIds: '["identifier","name"]',
      cardIds: '["founders"]',
      order: '[{"field_id":"rank_org","sort":"asc"}]',
      afterId: 'stale-cursor',
      collection: 'organizations',
    })

    expect(params.query).toBe('airbnb')
    expect(params.entityId).toBeUndefined()
    expect(params.fieldIds).toBeUndefined()
    expect(params.cardIds).toBeUndefined()
    expect(params.order).toBeUndefined()
    expect(params.afterId).toBeUndefined()
    expect(params.collection).toBeUndefined()
    expect(params.searchQuery).toBeUndefined()
    expect(params.autocompleteQuery).toBeUndefined()
  })

  it('routes the predicate query to a search and the text query to autocomplete', () => {
    const search = resolve({
      operation: 'search_organizations',
      apiKey: 'key',
      searchQuery: '[{"type":"predicate","field_id":"categories","operator_id":"includes"}]',
      autocompleteQuery: 'airbnb',
    })
    expect(search.query).toBe(
      '[{"type":"predicate","field_id":"categories","operator_id":"includes"}]'
    )

    const autocomplete = resolve({
      operation: 'autocomplete',
      apiKey: 'key',
      searchQuery: '[{"type":"predicate","field_id":"categories","operator_id":"includes"}]',
      autocompleteQuery: 'airbnb',
    })
    expect(autocomplete.query).toBe('airbnb')
  })

  it('picks the collection each operation actually asks for', () => {
    const card = resolve({
      operation: 'get_entity_card',
      apiKey: 'key',
      entityId: 'sequoia-capital',
      cardId: 'participated_investments',
      cardCollection: 'organizations',
      collection: 'events',
      deletedCollection: 'people',
    })
    expect(card.collection).toBe('organizations')
    expect(card.cardCollection).toBeUndefined()

    const deleted = resolve({
      operation: 'list_deleted_entities',
      apiKey: 'key',
      cardCollection: 'organizations',
      collection: 'events',
      deletedCollection: 'people',
    })
    expect(deleted.collection).toBe('people')
    expect(deleted.deletedCollection).toBeUndefined()
  })
})
