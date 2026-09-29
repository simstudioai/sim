import { parseExpression } from '@babel/parser'
import { expect, test } from 'vitest'
import { classMapTruth } from '#design-conformance/shared/class-map'
import { paintDeclarations } from '#design-conformance/shared/normalize'

test('logical border shorthands keep rem geometry separate from token paint', () => {
  expect(paintDeclarations('border-inline-start', '1rem solid var(--text-body)')).toEqual([
    { property: 'border-width', value: '1rem', category: 'borders' },
    { property: 'border-style', value: 'solid', category: 'borders' },
    { property: 'border-color', value: 'var(--text-body)', category: 'colours' },
  ])
})

test('negative zero bigint does not enable a class-map entry', () => {
  expect(classMapTruth(parseExpression('-0n'))).toBe(false)
  expect(classMapTruth(parseExpression('-1n'))).toBe(true)
})
