import { describe, expect, it } from 'vitest'
import { orderToastStack } from './toast'

type StackedToast = Parameters<typeof orderToastStack>[0][number]

function stacked(id: string, overrides: Partial<StackedToast> = {}): StackedToast {
  return {
    id,
    message: id,
    variant: 'default',
    duration: 5000,
    persistAcrossRoutes: false,
    ...overrides,
  }
}

const unlock = stacked('unlock', {
  duration: 0,
  action: { label: 'Unlock Workflow', onClick: () => {} },
})
const reconnecting = stacked('reconnecting', { variant: 'error', duration: 0 })

const frontToBack = (toasts: StackedToast[]) => orderToastStack(toasts).map((toast) => toast.id)

describe('orderToastStack', () => {
  it('keeps an actionable toast in front of a status toast raised after it', () => {
    expect(frontToBack([unlock, reconnecting])).toEqual(['unlock', 'reconnecting'])
  })

  it('keeps a status toast behind a timed toast raised before it', () => {
    expect(frontToBack([stacked('saved'), reconnecting])).toEqual(['saved', 'reconnecting'])
  })

  it('orders everything else newest first', () => {
    const joining = stacked('joining', { variant: 'error', duration: 0 })
    expect(frontToBack([unlock, reconnecting, stacked('saved'), joining])).toEqual([
      'saved',
      'unlock',
      'joining',
      'reconnecting',
    ])
  })
})
