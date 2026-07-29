/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'

describe('buildZipEntryPaths', () => {
  it('mirrors the workspace folder layout', () => {
    expect(
      buildZipEntryPaths([
        { name: '00_Executive-Overview.docx', folderPath: 'Motherland-Campaign' },
        { name: 'hero-key-art.png', folderPath: 'Motherland-Campaign/visuals' },
        { name: 'notes.md', folderPath: null },
      ])
    ).toEqual([
      'Motherland-Campaign/00_Executive-Overview.docx',
      'Motherland-Campaign/visuals/hero-key-art.png',
      'notes.md',
    ])
  })

  it('keeps same-named files in different folders apart', () => {
    expect(
      buildZipEntryPaths([
        { name: 'README.docx', folderPath: 'Evidence/01-Access-Control' },
        { name: 'README.docx', folderPath: 'Evidence/02-Awareness-Training' },
      ])
    ).toEqual([
      'Evidence/01-Access-Control/README.docx',
      'Evidence/02-Awareness-Training/README.docx',
    ])
  })

  it('suffixes collisions before the extension without touching the directory', () => {
    expect(
      buildZipEntryPaths([
        { name: 'report.pdf', folderPath: 'docs' },
        { name: 'report.pdf', folderPath: 'docs' },
        { name: 'report.pdf', folderPath: 'docs' },
        { name: 'notes', folderPath: 'docs' },
        { name: 'notes', folderPath: 'docs' },
      ])
    ).toEqual([
      'docs/report.pdf',
      'docs/report (1).pdf',
      'docs/report (2).pdf',
      'docs/notes',
      'docs/notes (1)',
    ])
  })

  it('drops the shared ancestor chain when rebasing', () => {
    expect(
      buildZipEntryPaths(
        [
          { name: 'plan.docx', folderPath: 'Clients/Acme/Campaign' },
          { name: 'hero.png', folderPath: 'Clients/Acme/Campaign/visuals' },
        ],
        { rebaseOnCommonFolder: true }
      )
    ).toEqual(['plan.docx', 'visuals/hero.png'])
  })

  it('compares the shared ancestor segment by segment, not by string prefix', () => {
    expect(
      buildZipEntryPaths(
        [
          { name: 'a.txt', folderPath: 'Reports' },
          { name: 'b.txt', folderPath: 'Reports-2026' },
        ],
        { rebaseOnCommonFolder: true }
      )
    ).toEqual(['Reports/a.txt', 'Reports-2026/b.txt'])
  })

  it('rebases to the archive root when every file shares one folder', () => {
    expect(
      buildZipEntryPaths(
        [
          { name: 'a.txt', folderPath: 'Clients/Acme' },
          { name: 'b.txt', folderPath: 'Clients/Acme' },
        ],
        { rebaseOnCommonFolder: true }
      )
    ).toEqual(['a.txt', 'b.txt'])
  })

  it('keeps full paths when a root-level file joins the selection', () => {
    expect(
      buildZipEntryPaths(
        [
          { name: 'a.txt', folderPath: 'Clients/Acme' },
          { name: 'b.txt', folderPath: null },
        ],
        { rebaseOnCommonFolder: true }
      )
    ).toEqual(['Clients/Acme/a.txt', 'b.txt'])
  })

  it('strips traversal and platform-illegal characters', () => {
    expect(
      buildZipEntryPaths([
        { name: '../../etc/passwd', folderPath: 'docs' },
        { name: 'C:\\Windows\\system.ini', folderPath: '../secrets' },
        { name: 'quarterly:report?.pdf', folderPath: 'q1/./q2' },
      ])
    ).toEqual(['docs/passwd', '_/secrets/system.ini', 'q1/_/q2/quarterly_report_.pdf'])
  })

  it('falls back to a usable name when nothing survives sanitization', () => {
    expect(buildZipEntryPaths([{ name: '..', folderPath: null }])).toEqual(['file'])
  })

  it('returns no paths for an empty selection', () => {
    expect(buildZipEntryPaths([], { rebaseOnCommonFolder: true })).toEqual([])
  })
})
