import { describe, expect, it } from 'vitest'
import { assertCodaLiveFixture } from '@/lib/knowledge/__integration__/coda-live-fixture'

const marker = 'SimConnector-fixture'
const source = { name: `Sim Coda connector verification ${marker}`, owner: 'Owner@example.com' }

describe('Coda live fixture validation', () => {
  it.each(['Owner@example.com', 'owner@example.com', ' OWNER@EXAMPLE.COM '])(
    'rejects the owner as the second identity: %s',
    (secondEmail) => {
      expect(() => assertCodaLiveFixture(source, marker, secondEmail)).toThrow(
        'Refusing to change sharing'
      )
    }
  )

  it('rejects a document outside the disposable fixture', () => {
    expect(() =>
      assertCodaLiveFixture({ ...source, name: 'Unrelated' }, marker, 'reader@example.com')
    ).toThrow('Refusing to change sharing')
  })

  it('accepts the disposable document with a distinct second identity', () => {
    expect(() => assertCodaLiveFixture(source, marker, 'reader@example.com')).not.toThrow()
  })
})
