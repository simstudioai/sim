import { describe, expect, it } from 'vitest'
import { parseCompany, parsePage } from '@/tools/companyenrich/utils'

describe('CompanyEnrich provider responses', () => {
  it('preserves nullable firmographics without coercing unknown values into facts', () => {
    const company = parseCompany({
      id: 'a',
      name: null,
      employees: '51-200',
      industry: null,
      technologies: null,
      location: { city: 'Paris', unknownNestedField: [0, null] },
    })
    expect(company).toMatchObject({ location: { city: 'Paris', unknownNestedField: [0, null] } })
    expect(company.name).toBeNull()
    expect(company.industry).toBeNull()
    expect(company.technologies).toEqual([])
    expect(company.employees).toBe('51-200')
    expect(() => parseCompany({ name: 'missing provider id' })).toThrow()
  })
  it('rejects malformed successful pages instead of silently dropping companies', () => {
    expect(() =>
      parsePage({ items: [{ name: 'missing id' }], page: 1, totalPages: 1, totalItems: 1 })
    ).toThrow()
    expect(() => parsePage({ items: null, page: 1, totalPages: 1, totalItems: 0 })).toThrow()
  })
})
