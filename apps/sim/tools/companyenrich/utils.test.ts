import { describe, expect, it } from 'vitest'
import { pagination, parseCompany, parsePage } from '@/tools/companyenrich/utils'

describe('CompanyEnrich provider responses', () => {
  it('preserves nullable firmographics without coercing unknown values into facts', () => {
    const company = parseCompany({
      id: 'a',
      name: null,
      employees: '51-200',
      industry: null,
      technologies: null,
    })
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
  it('prevents paid searches outside the documented page limits', () => {
    for (const params of [
      { page: 0 },
      { page: 1.1 },
      { pageSize: 0 },
      { pageSize: 101 },
      { page: 101, pageSize: 100 },
    ]) {
      expect(() => pagination(params)).toThrow()
    }
    expect(pagination({})).toEqual({ page: 1, pageSize: 10 })
    expect(pagination({ page: 100, pageSize: 100 })).toEqual({ page: 100, pageSize: 100 })
  })
})
