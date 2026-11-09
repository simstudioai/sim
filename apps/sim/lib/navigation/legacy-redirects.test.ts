/**
 * @vitest-environment node
 *
 * Failure mode: a saved link, email, or stored chat reference to a moved workspace URL lands on a
 * 404, or on another organization, instead of the page that replaced it.
 */
import { describe, expect, it } from 'vitest'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'

function map(path: string, organizationId: string | null = 'org-1') {
  const [pathname, search = ''] = path.split('?')
  return mapLegacyWorkspaceUrl({
    workspaceId: 'ws-1',
    segments: pathname.split('/').filter(Boolean),
    query: new URLSearchParams(search),
    organizationId,
  })
}

describe('mapLegacyWorkspaceUrl', () => {
  it.each([
    ['home', '/o/org-1/home'],
    ['home?resource=file-1', '/o/org-1/home?resource=file-1'],
    ['chat/chat-1', '/o/org-1/chat/chat-1'],
    ['skills', '/o/org-1/integrations?tab=skills&workspace=ws-1'],
    ['skills?skillId=skill-1', '/o/org-1/integrations?tab=skills&workspace=ws-1&resource=skill-1'],
    ['skills/new', '/o/org-1/integrations?tab=skills&workspace=ws-1&resource=new'],
    ['skills/skill-1', '/o/org-1/integrations?tab=skills&workspace=ws-1&resource=skill-1'],
    ['integrations', '/o/org-1/integrations'],
    ['integrations?slack=connected', '/o/org-1/integrations?slack=connected'],
    ['integrations/github', '/o/org-1/integrations/github'],
    ['integrations/connected/cred-1', '/o/org-1/integrations?tab=credentials'],
    ['upgrade', '/o/org-1/settings/billing/plans'],
    ['upgrade?reason=credits&ref=email', '/o/org-1/settings/billing/plans?reason=credits'],
    ['settings/general', '/o/org-1/settings/general'],
    ['settings/subscription', '/o/org-1/settings/subscription'],
    ['settings/billing/credit-usage', '/o/org-1/settings/billing/credit-usage'],
    ['settings/usage/events?period=7d', '/o/org-1/settings/usage/events?period=7d'],
    [
      'settings/access-control?access-view=requests',
      '/o/org-1/settings/access-control?access-view=requests',
    ],
    ['settings/apikeys', '/workspace/ws-1/settings/api-keys'],
    ['access-requests?requestId=req-1', '/workspace/ws-1/settings/requests?requestId=req-1'],
  ])('sends /workspace/ws-1/%s to %s', (path, expected) => {
    expect(map(path)).toBe(expected)
  })

  it.each(['home', 'chat/chat-1', 'skills', 'integrations', 'upgrade', 'settings/general'])(
    'gives a viewer who cannot open the workspace no destination for %s',
    (path) => {
      expect(map(path, null)).toBeNull()
    }
  )

  it.each(['settings/unknown-section', 'settings/teammates', 'chat', 'skills/a/b', 'home/extra'])(
    'gives an unmapped path %s no destination',
    (path) => {
      expect(map(path)).toBeNull()
    }
  )
})
