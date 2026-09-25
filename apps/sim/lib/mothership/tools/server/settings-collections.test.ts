/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  projectSettingsRoster,
  projectSettingsUsageBreakdown,
  settingsPage,
  settingsPageSchema,
} from '@/lib/mothership/tools/server/settings-collections'

describe('bounded Settings collection projections', () => {
  it('retains every item through stable pages with explicit totals', () => {
    const rows = Array.from({ length: 137 }, (_, i) => ({
      id: String(i).padStart(3, '0'),
    })).reverse()
    const seen: string[] = []
    let offset = 0
    do {
      const page = settingsPage(rows, { offset, limit: 25 }, (row) => row.id)
      expect(page.total).toBe(137)
      expect(page.items.length).toBeLessThanOrEqual(25)
      seen.push(...page.items.map((row) => row.id))
      if (page.nextOffset === null) break
      offset = page.nextOffset
    } while (offset < 137)
    expect(new Set(seen).size).toBe(137)
    expect(seen).toEqual([...seen].sort())
  })
  it('rejects excessive or negative pagination', () => {
    for (const page of [{ limit: 101 }, { offset: -1 }, { limit: 0 }, { offset: 1.5 }])
      expect(settingsPageSchema.safeParse(page).success).toBe(false)
  })
  it('bounds top-level and nested roster metadata and omits images', () => {
    const roster = {
      members: Array.from({ length: 120 }, (_, i) => ({
        memberId: `member-${i}`,
        userId: `user-${i}`,
        role: 'member' as const,
        createdAt: '2026-09-15',
        suspendedAt: null,
        name: 'n'.repeat(2000),
        email: 'e'.repeat(2000),
        image: 'private-image',
        workspaces: Array.from({ length: 1000 }, (_, j) => ({
          workspaceId: String(j),
          workspaceName: 'huge',
          permission: 'read' as const,
          roleSource: 'explicit' as const,
          isBilledAccount: false,
        })),
      })),
      pendingInvitations: [],
      workspaces: [],
    }
    const result = projectSettingsRoster(roster)
    expect(result.members).toMatchObject({ total: 120, truncated: true, nextOffset: 25 })
    expect(result.members.items).toHaveLength(25)
    expect(result.members.items[0]).toMatchObject({ workspaceCount: 1000 })
    expect(result.members.items[0].name).toHaveLength(300)
    expect(JSON.stringify(result)).not.toContain('private-image')
    expect(JSON.stringify(result)).not.toContain('"workspaces":[')
  })

  it('keeps member avatars out of the usage breakdown the model reads', () => {
    const result = projectSettingsUsageBreakdown({
      dimension: 'member',
      rows: [
        { id: 'u1', label: 'Ada', image: 'private-image' },
        { id: 'u2', label: 'Sam' },
      ],
      totalCredits: 3,
    })
    expect(result.rows).toEqual([
      { id: 'u1', label: 'Ada' },
      { id: 'u2', label: 'Sam' },
    ])
    expect(result).toMatchObject({ dimension: 'member', totalCredits: 3 })
  })
})
