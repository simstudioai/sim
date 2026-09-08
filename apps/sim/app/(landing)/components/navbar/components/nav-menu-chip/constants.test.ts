/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CUSTOMERS_MENU,
  NAV_MENUS,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/constants'

describe('navbar customers menu', () => {
  it('floats the featured customers as blocs, each with its mark', () => {
    expect(CUSTOMERS_MENU.label).toBe('Customers')
    expect(CUSTOMERS_MENU.layout).toBe('floating')
    expect(CUSTOMERS_MENU.marquee).toBe('customers')
    expect(CUSTOMERS_MENU.sections.map((section) => section.label)).toEqual(['Featured customers'])
    expect(CUSTOMERS_MENU.sections[0].items.map((item) => item.title)).toEqual([
      'Rivian',
      'eXp Realty',
    ])
    expect(CUSTOMERS_MENU.sections[0].items.map((item) => item.card?.tone)).toEqual([
      'dark',
      'dark',
    ])
    expect(CUSTOMERS_MENU.sections[0].items.map((item) => item.href)).toEqual([
      '/customers/rivian',
      '/customers/exp-realty',
    ])
    for (const item of CUSTOMERS_MENU.sections[0].items) {
      expect(item.card?.background?.src).toMatch(/^\/landing\/customers\/.+\.jpg$/)
      expect(item.card?.imageSrc).toMatch(/^\/landing\/logos\/.+\.svg$/)
      expect(item.card?.aspect).toBeGreaterThan(0)
    }
  })

  it('keeps customers between platform and resources', () => {
    expect(NAV_MENUS.map((menu) => menu.label)).toEqual(['Platform', 'Customers', 'Resources'])
  })
})
