/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

beforeEach(() => {
  localStorage.clear()
  useMothershipEffortStore.setState({
    effort: 'high',
    modelSelection: { model: 'gpt-6-astra', fastMode: false },
  })
})

describe('Build reasoning preferences', () => {
  it('replaces a saved Opus selection with Astra while preserving effort', async () => {
    localStorage.setItem(
      'mothership-effort',
      JSON.stringify({
        version: 0,
        state: { effort: 'xhigh', modelSelection: { model: 'claude-opus-5', fastMode: false } },
      })
    )
    await useMothershipEffortStore.persist.rehydrate()
    expect(useMothershipEffortStore.getState()).toMatchObject({
      effort: 'xhigh',
      modelSelection: { model: 'gpt-6-astra', fastMode: false },
    })
    useMothershipEffortStore.getState().setFastMode(true)
    expect(JSON.parse(localStorage.getItem('mothership-effort')!).state).toEqual({
      effort: 'xhigh',
      modelSelection: { model: 'gpt-6-astra', fastMode: true },
    })
  })

  it('restores effort and Fast mode together without changing the Build model', async () => {
    useMothershipEffortStore.getState().setEffort('max')
    useMothershipEffortStore.getState().setFastMode(true)
    const saved = localStorage.getItem('mothership-effort')!
    useMothershipEffortStore.setState({
      effort: 'high',
      modelSelection: { model: 'gpt-6-astra', fastMode: false },
    })
    localStorage.setItem('mothership-effort', saved)
    await useMothershipEffortStore.persist.rehydrate()
    expect(useMothershipEffortStore.getState()).toMatchObject({
      effort: 'max',
      modelSelection: { model: 'gpt-6-astra', fastMode: true },
    })
  })
})
