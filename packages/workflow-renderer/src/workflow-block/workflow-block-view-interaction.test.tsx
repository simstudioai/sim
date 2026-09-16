/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkflowTypeAccent,
  getWorkflowTypeRole,
  hasWorkflowTypeRole,
  WorkflowBlockView,
  WorkflowTypeIcon,
  WorkflowTypeTag,
} from '../index'

const mountedRoots = new Set<Root>()
const mountedHosts = new Set<HTMLDivElement>()

function TestIcon({ className }: { className?: string }) {
  return <svg aria-hidden='true' className={className} />
}

function createView(
  isRunning: boolean,
  isEnabled = true,
  isLocked = false,
  isExecutionHighlighted = false,
  cursorConnectionsEnabled = true
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
        cursorConnectionsEnabled={cursorConnectionsEnabled}
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
  it('keeps the preview edge swell without mounting a transient connector handle', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(false, true, false, false, false)))

    const card = host.querySelector<HTMLElement>('.workflow-drag-handle')
    expect(card).toBeTruthy()
    if (!card) return

    const cardRect = {
      left: 100,
      top: 100,
      right: 350,
      bottom: 196,
      width: 250,
      height: 96,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect
    card.getBoundingClientRect = () => cardRect
    document.elementFromPoint = () => card

    const silhouette = card.querySelector<SVGPathElement>('svg > path[fill="var(--border-1)"]')
    const restingPath = silhouette?.getAttribute('d')

    act(() => {
      card.dispatchEvent(
        new MouseEvent('pointerenter', { bubbles: true, clientX: 350, clientY: 148 })
      )
      window.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 350, clientY: 148 })
      )
    })
    flushAnimationFrames()

    expect(silhouette?.getAttribute('d')).not.toBe(restingPath)
    expect(card.querySelector('[data-handleid^="source-cursor"]')).toBeNull()
  })

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

  /**
   * A run pins the executing card's bar open, not every card's. Pinning them all
   * turned the canvas into a wall of open swells, and suspending their hover on
   * top of it left them unable to retract or respond.
   */
  it('leaves a bystander card retracted while another block runs', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(false, true, false, false)))
    flushAnimationFrames()

    const actionMenuRoot = host.querySelector<HTMLElement>('.group.relative')
    expect(actionMenuRoot).not.toHaveAttribute('data-action-menu-ready')
  })

  /**
   * The handoff source takes the selected treatment so the eye can follow the
   * baton, but that is not a reason to pin its toolbar open — that left the
   * upstream card's bar down for the whole run.
   */
  it('does not pin the toolbar open for a block merely in the handoff', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() => root.render(createView(false, true, false, true)))
    flushAnimationFrames()

    const actionMenuRoot = host.querySelector<HTMLElement>('.group.relative')
    expect(actionMenuRoot).toHaveAttribute('data-node-selected')
    expect(actionMenuRoot).not.toHaveAttribute('data-action-menu-ready')
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
    expect(getWorkflowTypeRole('credential_group')).toBe('identity')
    expect(getWorkflowTypeRole('router_v2')).toBe('flow')
    expect(getWorkflowTypeRole('table')).toBe('records')
    expect(getWorkflowTypeRole('a2a')).toBe('neutral')
    expect(getWorkflowTypeRole('image_generator_v2')).toBe('generative')
    expect(getWorkflowTypeRole('knowledge')).toBe('knowledge')
    expect(getWorkflowTypeRole('start_trigger')).toBe('flow')
    expect(getWorkflowTypeRole('schedule')).toBe('flow')
    expect(getWorkflowTypeRole('generic_webhook')).toBe('interface')
    expect(getWorkflowTypeRole('imap')).toBe('interface')
    expect(getWorkflowTypeRole('rss')).toBe('knowledge')
    expect(getWorkflowTypeRole('sim_workspace_event')).toBe('interface')

    expect(getWorkflowTypeAccent('agent')).toEqual({ variant: 'workflow', tone: 'inverse' })
    expect(getWorkflowTypeAccent('api')).toEqual({ variant: 'workflow', tone: 'blue' })
    expect(getWorkflowTypeAccent('loop')).toEqual({ variant: 'workflow', tone: 'ash' })
    expect(getWorkflowTypeAccent('parallel')).toEqual({ variant: 'workflow', tone: 'ash' })
    expect(getWorkflowTypeAccent('router')).toEqual({ variant: 'workflow', tone: 'ash' })
    expect(getWorkflowTypeAccent('condition')).toEqual({ variant: 'workflow', tone: 'orange' })
    expect(getWorkflowTypeAccent('credential_group')).toEqual({
      variant: 'workflow',
      tone: 'identity',
    })
    expect(getWorkflowTypeAccent('image_generator_v2')).toEqual({
      variant: 'workflow',
      tone: 'purple',
    })
    expect(getWorkflowTypeAccent('knowledge')).toEqual({ variant: 'workflow', tone: 'content' })
  })

  it('distinguishes semantic workflow types from branded providers', () => {
    expect(hasWorkflowTypeRole('start_trigger')).toBe(true)
    expect(hasWorkflowTypeRole('schedule')).toBe(true)
    expect(hasWorkflowTypeRole('generic_webhook')).toBe(true)
    expect(hasWorkflowTypeRole('table')).toBe(true)
    expect(hasWorkflowTypeRole('circleback')).toBe(false)
    expect(hasWorkflowTypeRole('airtable')).toBe(false)
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
          <WorkflowTypeIcon type='credential_group' Icon={TestIcon} />
        </>
      )
    )

    expect(host.querySelector('[data-workflow-type-icon="knowledge"]')).toHaveClass(
      'bg-[#007E80]',
      'text-[#FFFFFF]'
    )
    expect(host.querySelector('[data-workflow-type-icon="image_generator_v2"]')).toHaveClass(
      'bg-[#AA00FF]',
      'text-[#F8F8F8]'
    )
    expect(host.querySelector('[data-workflow-type-icon="credential_group"]')).toHaveClass(
      'bg-[#8B5CF6]',
      'text-[#F8F8F8]'
    )
  })

  it('renders the Credential Groups header tag with its purple identity fill', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() =>
      root.render(
        <WorkflowTypeTag
          type='credential_group'
          typeLabel='Credential Groups'
          Icon={TestIcon}
          iconBgColor='#8B5CF6'
        />
      )
    )

    expect(host.querySelector('[data-workflow-type-accent="credential_group"]')).toHaveClass(
      'bg-[#8B5CF6]',
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

  /**
   * The label used to drop out whenever the block's title already said the same
   * word, so a freshly dropped Wait showed a bare icon and its second copy —
   * named "Wait 2" — showed "Wait". The tag names the block's kind; it is not a
   * badge that appears on rename.
   */
  it('names the block type even when the title already says it', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mountedRoots.add(root)
    mountedHosts.add(host)

    act(() =>
      root.render(<WorkflowTypeTag type='wait' typeLabel='Wait' Icon={TestIcon} iconBgColor='' />)
    )

    expect(host.querySelector<HTMLElement>('[data-workflow-type-accent]')).toHaveTextContent('Wait')
  })
})
