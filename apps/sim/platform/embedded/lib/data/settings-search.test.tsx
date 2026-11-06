/**
 * @vitest-environment jsdom
 *
 * A search result promises a row. Failure modes: an index entry naming a row its section does not
 * render, the reveal scrolling something outside the section, an older wait firing after a newer
 * click, the wait outliving the page, and a repeat click on the same result doing nothing.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { parseAsString, useQueryState } from 'nuqs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SettingsNavGroup,
  SettingsSectionKey,
} from '@/platform/embedded/lib/data/settings-navigation'
import {
  SETTINGS_SEARCH_INDEX,
  searchSettings,
  useSettingRowReveal,
} from '@/platform/embedded/lib/data/settings-search'
import { renderDataHook, unmountDataHooks } from '@/platform/embedded/lib/render-hook.test-support'

const SETTINGS_ROOT = path.resolve(__dirname, '../../app/(shell)/settings/_components')

/** The files that render each section's rows on the view its search results open. */
const SECTION_SOURCES: Partial<Record<SettingsSectionKey, readonly string[]>> = {
  general: [
    'profile/profile-settings.tsx',
    'sections/preferences/preferences-section.tsx',
    'sections/account/account-section.tsx',
  ],
  billing: ['sections/billing/billing-view.tsx'],
  'knowledge-graphs': ['sections/knowledge-graphs/knowledge-graphs-section.tsx'],
  members: ['sections/members/members-panel.tsx', 'sections/members/seats-overview.tsx'],
  'connected-accounts': [
    'sections/connected-accounts/group-people.tsx',
    'sections/connected-accounts/group-providers.tsx',
  ],
  whitelabeling: ['sections/whitelabeling/whitelabeling-section.tsx'],
  'recently-deleted': ['sections/recently-deleted/recently-deleted-section.tsx'],
  requests: ['sections/requests/review-requests.tsx'],
  'audit-logs': ['sections/audit-logs/audit-logs-section.tsx'],
  sso: [
    'sections/sso/sso-section.tsx',
    'sections/sso/require-sso.tsx',
    'sections/sso/domains-panel.tsx',
    'sections/sso/scim-panel.tsx',
  ],
  security: ['sections/security/security-section.tsx'],
  'data-retention': ['sections/data-retention/data-retention-section.tsx'],
  'data-drains': ['sections/data-drains/data-drains-section.tsx'],
  integrations: [
    'sections/integrations/integrations-section.tsx',
    'sections/integrations/generic-secrets.tsx',
  ],
  'search-mcp': ['sections/search-mcp/search-mcp-section.tsx'],
  'search-slack': ['sections/search-slack/search-slack-section.tsx'],
  admin: ['sections/admin/admin-section.tsx'],
}

const ROW_ELEMENTS =
  /<(?:SettingsRow|BooleanRow)\b[^>]*?\blabel=(?:'([^']+)'|\{(\w+)\})|<(?:SettingsSection|SavedSettingsSection)\b[^>]*?\btitle=(?:'([^']+)'|\{(\w+)\})/gs

/** The labels a source renders as rows, following a label held in one of its own constants. */
function renderedRows(source: string): Set<string> {
  const rows = new Set<string>()
  for (const [, label, labelName, title, titleName] of source.matchAll(ROW_ELEMENTS)) {
    const literal = label ?? title
    const name = labelName ?? titleName
    if (literal) rows.add(literal)
    if (name) {
      const constant = source.match(new RegExp(`const ${name} = '([^']+)'`))
      if (constant) rows.add(constant[1])
    }
  }
  return rows
}

describe('SETTINGS_SEARCH_INDEX', () => {
  const sections = Object.entries(SETTINGS_SEARCH_INDEX) as [
    SettingsSectionKey,
    NonNullable<(typeof SETTINGS_SEARCH_INDEX)[SettingsSectionKey]>,
  ][]
  const withRows = sections.flatMap(([section, entries]) =>
    entries.flatMap((entry) => (entry.row ? [[section, entry.label, entry.row] as const] : []))
  )

  it.each(withRows)('%s: "%s" names the row "%s", which its section renders', (section, _, row) => {
    const sources = SECTION_SOURCES[section]
    expect(sources, `no sources listed for ${section}`).toBeDefined()
    const rendered = new Set(
      (sources ?? []).flatMap((file) => [
        ...renderedRows(readFileSync(path.join(SETTINGS_ROOT, file), 'utf8')),
      ])
    )
    expect([...rendered]).toContain(row)
  })
})

const GROUPS: SettingsNavGroup[] = [
  {
    key: 'security',
    title: 'Security',
    items: [
      { key: 'sso', title: 'Single sign-on', icon: 'I137', href: '/o/org/settings/sso' },
      { key: 'billing', title: 'Billing', icon: 'I138', href: '/o/org/settings/billing' },
    ],
  },
]

describe('searchSettings', () => {
  const hrefOf = (query: string) =>
    searchSettings(query, GROUPS, { isAdmin: true, hosted: true })
      .flatMap((group) => group.results)
      .map((result) => result.href)

  it('carries the row in the destination, beside the view that renders it', () => {
    expect(hrefOf('tokens')).toEqual(['/o/org/settings/sso?tab=provisioning&row=Tokens'])
  })

  it('opens the section alone for a setting with no row', () => {
    expect(hrefOf('subscription')).toEqual(['/o/org/settings/billing'])
  })
})

describe('useSettingRowReveal', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(async () => {
    await unmountDataHooks()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  function row(label: string) {
    const element = document.createElement('div')
    element.dataset.settingLabel = label
    return element
  }

  async function mountWithRoot(search: string) {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const rendered = await renderDataHook(
      () => {
        const ref = useSettingRowReveal<HTMLDivElement>()
        ref.current = root
        return useQueryState('row', parseAsString)[1]
      },
      { search }
    )
    return { root, ...rendered }
  }

  function scrolled() {
    return scrollIntoView.mock.contexts.map(
      (element) => (element as HTMLElement).dataset.settingLabel
    )
  }

  it('scrolls to a row that renders late, once, then strips the param', async () => {
    const { root, urls } = await mountWithRoot('?row=Tokens')
    expect(scrolled()).toEqual([])

    await act(async () => {
      root.appendChild(row('Tokens'))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      root.appendChild(row('Other'))
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(scrolled()).toEqual(['Tokens'])
    expect(urls.at(-1)).toBe('')
  })

  it('looks only inside the section, past a row with the same label elsewhere', async () => {
    document.body.appendChild(row('Tokens'))

    await mountWithRoot('?row=Tokens')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(scrolled()).toEqual([])
  })

  it('gives up on a row that never comes, and strips the param', async () => {
    const { root, urls } = await mountWithRoot('?row=Tokens')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100)
    })
    expect(urls.at(-1)).toBe('')

    await act(async () => {
      root.appendChild(row('Tokens'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(scrolled()).toEqual([])
  })

  it('cancels the wait when the page leaves', async () => {
    const { root, unmount } = await mountWithRoot('?row=Tokens')

    await unmount()
    root.appendChild(row('Tokens'))
    await vi.advanceTimersByTimeAsync(0)

    expect(scrolled()).toEqual([])
  })

  it('cancels the first wait when a second result is clicked', async () => {
    const { root, result } = await mountWithRoot('?row=Tokens')

    await act(async () => {
      void result.current('Other')
      await vi.advanceTimersByTimeAsync(100)
    })
    await act(async () => {
      root.appendChild(row('Tokens'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(scrolled()).toEqual([])

    await act(async () => {
      root.appendChild(row('Other'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(scrolled()).toEqual(['Other'])
  })

  it('reveals again when the same result is clicked twice', async () => {
    const { root, result } = await mountWithRoot('?row=Tokens')
    root.appendChild(row('Tokens'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(scrolled()).toEqual(['Tokens'])

    await act(async () => {
      void result.current('Tokens')
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(scrolled()).toEqual(['Tokens', 'Tokens'])
  })
})
