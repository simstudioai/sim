/**
 * @vitest-environment node
 */
import { isValidUuid } from '@sim/utils/id'
import { describe, expect, it } from 'vitest'
import { uuidV5 } from '@/lib/core/utils/uuid-v5'

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

describe('uuidV5', () => {
  it('matches the RFC 4122 reference vector', () => {
    expect(uuidV5('python.org', DNS_NAMESPACE)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })

  it('is deterministic and namespace-scoped', () => {
    const a = uuidV5('customer-456', DNS_NAMESPACE)
    expect(uuidV5('customer-456', DNS_NAMESPACE)).toBe(a)
    expect(uuidV5('customer-457', DNS_NAMESPACE)).not.toBe(a)
    expect(uuidV5('customer-456', '00000000-0000-0000-0000-000000000000')).not.toBe(a)
    expect(isValidUuid(a)).toBe(true)
    expect(a[14]).toBe('5')
  })
})
