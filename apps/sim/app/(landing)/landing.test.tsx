/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('@/app/(landing)/components', () => ({
  AgentMomentum: () => <span>agent-momentum-marker</span>,
  Features: () => <span>features-marker</span>,
  FeaturedCustomer: () => <span>featured-customer-marker</span>,
  Hero: () => null,
  HomeStructuredData: () => null,
  PlatformSuite: () => <span>platform-suite-marker</span>,
  ProductDemo: () => <span>product-demo-marker</span>,
  Proof: () => null,
  Security: () => <span>security-marker</span>,
  WorkspaceControls: () => <span>workspace-controls-marker</span>,
}))

vi.mock('@/app/(landing)/components/landing-layout', () => ({
  HOME_SECTION_RHYTHM: 'gap-test',
}))

vi.mock('@/app/(landing)/landing-analytics', () => ({
  LandingAnalytics: () => <span>landing-analytics-marker</span>,
}))

import Landing from '@/app/(landing)/landing'

describe('Landing', () => {
  it('mounts the landing page analytics tracker exactly once', () => {
    const markup = renderToStaticMarkup(<Landing />)

    expect(markup.match(/landing-analytics-marker/g)).toHaveLength(1)
  })

  it('places the agent momentum section directly after featured customers', () => {
    const markup = renderToStaticMarkup(<Landing />)
    const featuredCustomerIndex = markup.indexOf('featured-customer-marker')
    const agentMomentumIndex = markup.indexOf('agent-momentum-marker')
    const platformSuiteIndex = markup.indexOf('platform-suite-marker')

    expect(featuredCustomerIndex).toBeGreaterThan(-1)
    expect(agentMomentumIndex).toBeGreaterThan(featuredCustomerIndex)
    expect(platformSuiteIndex).toBeGreaterThan(agentMomentumIndex)
  })

  it('places the workspace controls between the feature rail and the governance beat', () => {
    const markup = renderToStaticMarkup(<Landing />)
    const featuresIndex = markup.indexOf('features-marker')
    const workspaceControlsIndex = markup.indexOf('workspace-controls-marker')
    const securityIndex = markup.indexOf('security-marker')

    expect(featuresIndex).toBeGreaterThan(-1)
    expect(workspaceControlsIndex).toBeGreaterThan(featuresIndex)
    expect(securityIndex).toBeGreaterThan(workspaceControlsIndex)
  })

  it('groups only the platform cards and the demo frame, so the frame still follows the cards', () => {
    const markup = renderToStaticMarkup(<Landing />)
    const group = markup.match(/<div class="flex flex-col gap-4">(.*?)<\/div>/)?.[1]

    expect(group).toContain('platform-suite-marker')
    expect(group).toContain('product-demo-marker')
    expect(group).not.toContain('workspace-controls-marker')
  })
})
