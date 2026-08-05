/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import {
  getWorkflowTypeAccent,
  getWorkflowTypeRole,
  WorkflowBlockView,
  WorkflowTypeIcon,
  WorkflowTypeTag,
} from '@sim/workflow-renderer'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mountedRoots = new Set<Root>()
const mountedHosts = new Set<HTMLDivElement>()

function TestIcon({ className }: { className?: string }) {
  return <svg aria-hidden='true' className={className} />
}

function createView(
  isRunning: boolean,
  isEnabled = true,
  isLocked = false,
  isExecutionHighlighted = false
) {
  return (
    <ReactFlowProvider>
      <WorkflowBlockView
        id='block-1'
        type='function'
        name='Validate Input'
        isEnabled={isEnabled}
        isLocked={isLocked}
        hasRing={false}
        ringStyles=''
        isRunning={isRunning}
        isExecutionHighlighted={isExecutionHighlighted}
        Icon={TestIcon}
        iconBgColor='var(--surface-2)'
        horizontalHandles={true}
        shouldShowDefaultHandles={false}
        blockHeight={96}
        hasContentBelowHeader={false}
        conditionRows={[]}
        routerRows={[]}
        wouldCreateConnectionCycle={() => false}
        onSelect={() => {}}
        actionBar={<div data-workflow-action-bar-swell='' />}
        rows={null}
      />
    </ReactFlowProvider>
  )
}

function flushAnimationFrames() {
  act(() => {
    vi.runAllTimers()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0)
  )
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  act(() => {
    mountedRoots.forEach((root) => root.unmount())
  })
  mountedRoots.clear()
  mountedHosts.forEach((host) => host.remove())
  mountedHosts.clear()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WorkflowBlockView action menu', () => {
  it('keeps an executing block visually unselected while its actions stay available', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(true)))
    flushAnimationFrames()

    const actionMenuRoot = host.querySelector<HTMLElement>('.group.relative')
    expect(actionMenuRoot).not.toHaveAttribute('data-node-selected')
    expect(actionMenuRoot).toHaveAttribute('data-action-menu-ready')
  })

  it('uses the selected graphite treatment for a block in the active handoff', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(true, true, false, true)))
    flushAnimationFrames()

    const actionMenuRoot = host.querySelector<HTMLElement>('.group.relative')
    expect(actionMenuRoot).toHaveAttribute('data-node-selected')
    expect(actionMenuRoot).toHaveAttribute('data-execution-highlighted')
  })

  it('clears stale hover when execution stops and waits for a fresh pointer entry', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(false)))
    const actionMenuRoot = host.querySelector<HTMLElement>('.group.relative')
    expect(actionMenuRoot).toBeTruthy()

    act(() => actionMenuRoot?.dispatchEvent(new Event('pointerenter')))
    flushAnimationFrames()
    expect(actionMenuRoot).toHaveAttribute('data-action-menu-ready')

    act(() => root.render(createView(true)))
    flushAnimationFrames()
    expect(actionMenuRoot).toHaveAttribute('data-action-menu-ready')

    act(() => root.render(createView(false)))
    flushAnimationFrames()
    expect(actionMenuRoot).not.toHaveAttribute('data-action-menu-ready')

    act(() => actionMenuRoot?.dispatchEvent(new Event('pointerenter')))
    flushAnimationFrames()
    expect(actionMenuRoot).toHaveAttribute('data-action-menu-ready')
  })

  it('places active block-state indicators before the type tag', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(false, false, true)))

    const disabledIndicator = host.querySelector('[aria-label="Disabled"]')
    const lockedIndicator = host.querySelector('[aria-label="Locked"]')
    const typeTag = host.querySelector('[data-workflow-type-accent="function"]')
    expect(Array.from(typeTag?.parentElement?.children ?? [])).toEqual([
      disabledIndicator,
      lockedIndicator,
      typeTag,
    ])
  })
})

describe('WorkflowTypeTag colors', () => {
  it('maps core blocks through semantic workflow roles', () => {
    expect(getWorkflowTypeRole('agent')).toBe('agentic')
    expect(getWorkflowTypeRole('api')).toBe('interface')
    expect(getWorkflowTypeRole('condition')).toBe('logic')
    expect(getWorkflowTypeRole('credential')).toBe('state')
    expect(getWorkflowTypeRole('router_v2')).toBe('flow')
    expect(getWorkflowTypeRole('table')).toBe('records')
    expect(getWorkflowTypeRole('a2a')).toBe('neutral')
    expect(getWorkflowTypeRole('image_generator_v2')).toBe('generative')
    expect(getWorkflowTypeRole('knowledge')).toBe('knowledge')

    expect(getWorkflowTypeAccent('agent')).toEqual({ variant: 'workflow', tone: 'inverse' })
    expect(getWorkflowTypeAccent('api')).toEqual({ variant: 'workflow', tone: 'blue' })
    expect(getWorkflowTypeAccent('loop')).toEqual({ variant: 'workflow', tone: 'ash' })
    expect(getWorkflowTypeAccent('parallel')).toEqual({ variant: 'workflow', tone: 'ash' })
    expect(getWorkflowTypeAccent('router')).toEqual({ variant: 'workflow', tone: 'ash' })
    expect(getWorkflowTypeAccent('condition')).toEqual({ variant: 'workflow', tone: 'orange' })
    expect(getWorkflowTypeAccent('image_generator_v2')).toEqual({
      variant: 'workflow',
      tone: 'purple',
    })
    expect(getWorkflowTypeAccent('knowledge')).toEqual({ variant: 'workflow', tone: 'content' })
  })

  it('renders compact workflow icons with their canonical fill and ink', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() =>
      root.render(
        <>
          <WorkflowTypeIcon type='knowledge' Icon={TestIcon} />
          <WorkflowTypeIcon type='image_generator_v2' Icon={TestIcon} />
        </>
      )
    )

    expect(host.querySelector('[data-workflow-type-icon="knowledge"]')).toHaveClass(
      'bg-[#888888]',
      'text-[#FFFFFF]'
    )
    expect(host.querySelector('[data-workflow-type-icon="image_generator_v2"]')).toHaveClass(
      'bg-[#AA00FF]',
      'text-[#F8F8F8]'
    )
  })

  it('uses the provider background with a contrasting shared icon and label color', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() =>
      root.render(
        <WorkflowTypeTag
          type='airweave'
          typeLabel='Airweave'
          blockName='Search Collections'
          Icon={TestIcon}
          iconBgColor='#6366F1'
          isIntegration
        />
      )
    )

    const tag = host.querySelector<HTMLElement>('[data-workflow-brand-tag]')
    expect(tag).toHaveStyle({ background: '#6366F1' })
    expect(tag).toHaveClass('text-[#FFFFFF]')
    expect(tag).toHaveTextContent('Airweave')

    act(() =>
      root.render(
        <WorkflowTypeTag
          type='gmail'
          typeLabel='Gmail'
          blockName='Send Email'
          Icon={TestIcon}
          iconBgColor='#FFFFFF'
          isIntegration
        />
      )
    )

    const lightTag = host.querySelector<HTMLElement>('[data-workflow-brand-tag]')
    expect(lightTag).toHaveStyle({ background: '#FFFFFF' })
    expect(lightTag).toHaveClass('text-[#000000]')
  })
})
