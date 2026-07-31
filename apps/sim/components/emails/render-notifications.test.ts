/**
 * Executes the notification templates for real. Every other suite mocks the
 * render functions, so without this nothing would catch a template that throws
 * or silently drops its key copy.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  renderScheduleDisabledEmail,
  renderUsageLimitReachedEmail,
} from '@/components/emails/render'

describe('renderScheduleDisabledEmail', () => {
  it('renders the failure count for a threshold disable', async () => {
    const html = await renderScheduleDisabledEmail({
      recipientName: 'John',
      kind: 'workflow',
      resourceName: 'Daily digest',
      reason: 'consecutive_failures',
      failedCount: 100,
      manageLink: 'https://sim.ai/workspace/ws_123/w/wf_456',
    })

    expect(html).toContain('Daily digest')
    expect(html).toContain('It failed 100 times in a row.')
    expect(html).toContain('Open workflow')
    expect(html).toContain('https://sim.ai/workspace/ws_123/w/wf_456')
  })

  it('renders reason copy instead of a count for a single-strike disable', async () => {
    const html = await renderScheduleDisabledEmail({
      kind: 'job',
      resourceName: 'Weekly report',
      reason: 'authentication_error',
      manageLink: 'https://sim.ai/workspace/ws_123/scheduled-tasks',
    })

    expect(html).toContain('could not be authenticated')
    expect(html).not.toContain('times in a row')
    expect(html).toContain('Open scheduled tasks')
  })

  it('falls back to a generic noun and omits the CTA when the source is unknown', async () => {
    const html = await renderScheduleDisabledEmail({
      kind: 'workflow',
      reason: 'workflow_not_found',
    })

    expect(html).toContain('a scheduled workflow')
    expect(html).not.toContain('Open workflow')
  })
})

describe('renderUsageLimitReachedEmail', () => {
  it('tells a personal payer to raise their limit, never to upgrade to Pro', async () => {
    const html = await renderUsageLimitReachedEmail({
      userName: 'John',
      planName: 'Pro',
      scope: 'user',
      currentUsage: 20,
      limit: 20,
      ctaLink: 'https://sim.ai/account/settings/billing',
    })

    expect(html).toContain('Raise Usage Limit')
    expect(html).toContain('upgrade your plan')
    expect(html).not.toContain('Upgrade to Pro')
    expect(html).not.toContain('free credits')
  })

  it('points an organization at the org limit', async () => {
    const html = await renderUsageLimitReachedEmail({
      planName: 'Team',
      scope: 'organization',
      currentUsage: 500,
      limit: 500,
      ctaLink: 'https://sim.ai/organization/org_1/settings/billing',
    })

    expect(html).toContain('Raise Organization Limit')
    expect(html).toContain('organization usage limit')
    expect(html).not.toContain('upgrade your plan')
  })

  it('renders credits, not dollars', async () => {
    const html = await renderUsageLimitReachedEmail({
      planName: 'Pro',
      scope: 'user',
      currentUsage: 20,
      limit: 20,
      ctaLink: 'https://sim.ai/account/settings/billing',
    })

    expect(html).toContain('credits used')
    expect(html).not.toContain('$20')
  })
})
