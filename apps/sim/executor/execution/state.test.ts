/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ExecutionState } from '@/executor/execution/state'

describe('ExecutionState', () => {
  it('returns exact suffixed cached node outputs', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer₍1₎', { value: 'branch-1' })
    state.setBlockOutput('producer_loop1', { value: 'loop-1' })

    expect(state.getBlockOutput('producer₍1₎')).toEqual({ value: 'branch-1' })
    expect(state.getBlockOutput('producer_loop1')).toEqual({ value: 'loop-1' })
  })

  it('prefers branch-local cloned outputs when resolving original block references', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer', { value: 'branch-0' })
    state.setBlockOutput('producer__cloneaaa__obranch-2', { value: 'branch-2' })

    expect(state.getBlockOutput('producer', 'consumer__clonebbb__obranch-2')).toEqual({
      value: 'branch-2',
    })
  })

  it('keeps cloned parallel branch references scoped to the same branch index', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer__cloneaaa__obranch-2₍0₎', { value: 'branch-0' })
    state.setBlockOutput('producer__cloneaaa__obranch-2₍1₎', { value: 'branch-1' })

    expect(state.getBlockOutput('producer', 'consumer__clonebbb__obranch-2₍1₎')).toEqual({
      value: 'branch-1',
    })
  })

  it('does not fall back to another branch when cloned scoped output is missing', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer₍0₎', { value: 'wrong-branch' })

    expect(state.getBlockOutput('producer', 'consumer__clonebbb__obranch-2')).toBeUndefined()
  })

  it('resolves regular sibling outputs from the same parent parallel branch', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer₍2₎', { value: 'parent-branch-2' })

    expect(state.getBlockOutput('producer', 'consumer__clonebbb__obranch-2₍0₎')).toEqual({
      value: 'parent-branch-2',
    })
  })

  it('does not fall back to direct branch-zero output from cloned nodes', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer', { value: 'branch-0' })

    expect(state.getBlockOutput('producer', 'consumer__clonebbb__obranch-2')).toBeUndefined()
  })

  it('resolves branch-zero sibling output deterministically for unsuffixed nested branch nodes', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer₍1₎', { value: 'branch-1' })
    state.setBlockOutput('producer₍0₎', { value: 'branch-0' })

    expect(state.getBlockOutput('producer', 'nested-condition')).toEqual({ value: 'branch-0' })
  })

  it('prefers stable branch-zero aliases when later batches reuse local branch ids', () => {
    const state = new ExecutionState()
    state.setBlockOutput('producer__obranch-0', { value: 'global-branch-0' })
    state.setBlockOutput('producer₍0₎', { value: 'later-batch-local-0' })

    expect(state.getBlockOutput('producer', 'after-parallel')).toEqual({
      value: 'global-branch-0',
    })
  })
})
