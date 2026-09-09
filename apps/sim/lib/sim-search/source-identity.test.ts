/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  createSourceLabelMetadata,
  describeSearchSource,
  normalizeSourceSelectionLabels,
  readSourceSelectionLabels,
  SOURCE_LABELS_KEY,
  searchSourceIdentity,
} from '@/lib/sim-search/source-identity'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

describe('Search source identity', () => {
  it('normalizes multi-value settings and ignores runtime mappings and cleared caps', () => {
    expect(
      searchSourceIdentity(confluenceConnectorMeta, {
        domain: ' acme.atlassian.net ',
        spaceKey: 'ENG, OPS,ENG',
        maxPages: '10',
      })
    ).toBe(
      searchSourceIdentity(confluenceConnectorMeta, {
        spaceKey: ['OPS', 'ENG'],
        domain: 'acme.atlassian.net',
        maxPages: 0,
        tagSlotMapping: { title: 'tag1' },
      })
    )
  })

  it('keeps separate sites, source filters, GitLab hosts and repositories distinct', () => {
    const confluence = { domain: 'one.atlassian.net', spaceKey: 'ENG' }
    for (const change of [
      { domain: 'two.atlassian.net' },
      { spaceKey: 'OPS' },
      { labelFilter: 'public' },
    ]) {
      expect(searchSourceIdentity(confluenceConnectorMeta, confluence)).not.toBe(
        searchSourceIdentity(confluenceConnectorMeta, { ...confluence, ...change })
      )
    }
    const gitlab = { host: 'gitlab.one.example', project: 'group/repo', ref: 'main' }
    for (const change of [
      { host: 'gitlab.two.example' },
      { project: 'group/other' },
      { ref: 'release' },
    ]) {
      expect(searchSourceIdentity(gitlabConnectorMeta, gitlab)).not.toBe(
        searchSourceIdentity(gitlabConnectorMeta, { ...gitlab, ...change })
      )
    }
  })

  it('describes declared source addresses without exposing credentials or arbitrary config', () => {
    expect(
      describeSearchSource(gitlabConnectorMeta, {
        host: 'gitlab.one.example',
        project: 'group/repo',
        apiKey: 'secret',
        encryptedApiKey: 'ciphertext',
        arbitrary: 'private value',
        issueLabels: 'confidential filter',
      })
    ).toBe('gitlab.one.example · group/repo')
    expect(
      describeSearchSource(confluenceConnectorMeta, { domain: 'x'.repeat(500) }).length
    ).toBeLessThanOrEqual(240)
  })

  it('uses readable counts for opaque legacy IDs and leaves unconfigured defaults unchanged', () => {
    expect(describeSearchSource(googleDriveConnectorMeta, { folderId: 'opaque-folder-id' })).toBe(
      '1 folder selected'
    )
    expect(
      describeSearchSource(googleDriveConnectorMeta, { folderId: ['folder-a', 'folder-b'] })
    ).toBe('2 folders selected')
    expect(describeSearchSource(googleDriveConnectorMeta, {})).toBe('')
    expect(describeSearchSource(gitlabConnectorMeta, { project: '12345' })).toBe(
      '1 project selected'
    )
  })

  it('uses selected folder names without changing deduplication identity', () => {
    const config = { folderId: ['folder-b', 'folder-a'] }
    const sourceLabels = createSourceLabelMetadata(googleDriveConnectorMeta, config, {
      folderId: [
        { id: 'folder-a', label: 'Engineering' },
        { id: 'folder-b', label: 'Company docs' },
      ],
    })
    const labeledConfig = { ...config, [SOURCE_LABELS_KEY]: sourceLabels }
    expect(describeSearchSource(googleDriveConnectorMeta, labeledConfig)).toBe(
      'Engineering · Company docs'
    )
    expect(searchSourceIdentity(googleDriveConnectorMeta, labeledConfig)).toBe(
      searchSourceIdentity(googleDriveConnectorMeta, config)
    )
  })

  it('drops saved labels when selections or source settings change', () => {
    const config = { folderId: ['folder-a'], fileType: 'documents' }
    const labeledConfig = {
      ...config,
      [SOURCE_LABELS_KEY]: createSourceLabelMetadata(googleDriveConnectorMeta, config, {
        folderId: [{ id: 'folder-a', label: 'Engineering' }],
      }),
    }
    for (const changed of [{ folderId: ['folder-b'] }, { fileType: 'spreadsheets' }]) {
      expect(describeSearchSource(googleDriveConnectorMeta, { ...labeledConfig, ...changed })).toBe(
        '1 folder selected'
      )
    }
  })

  it('rejects mismatched or partial label sets even when the config identity matches', () => {
    const config = { folderId: ['folder-a', 'folder-b'] }
    for (const options of [
      [{ id: 'folder-a', label: 'Engineering' }],
      [{ id: 'other-folder', label: 'Unrelated docs' }],
    ]) {
      expect(
        describeSearchSource(googleDriveConnectorMeta, {
          ...config,
          [SOURCE_LABELS_KEY]: {
            identity: searchSourceIdentity(googleDriveConnectorMeta, config),
            fields: { folderId: options },
          },
        })
      ).toBe('2 folders selected')
    }
  })

  it('bounds metadata, rejects ID-only labels, and never reads secret config fields as labels', () => {
    for (const options of [
      [{ id: 'folder-a', label: 'folder-a' }],
      [{ id: 'folder-a', label: 'x'.repeat(161) }],
      [{ id: 'folder-a', label: 'Unsafe\nlabel' }],
      Array.from({ length: 51 }, (_, index) => ({
        id: `folder-${index}`,
        label: `Folder ${index}`,
      })),
    ]) {
      expect(normalizeSourceSelectionLabels({ folderId: options })).toEqual({})
    }
    const config = { folderId: ['folder-a'], apiKey: 'secret' }
    const metadata = createSourceLabelMetadata(googleDriveConnectorMeta, config, {
      folderId: [{ id: 'folder-a', label: 'Engineering', secret: 'do not persist' }],
      apiKey: [{ id: 'secret', label: 'do not display' }],
    })
    expect(metadata?.fields).toEqual({ folderId: [{ id: 'folder-a', label: 'Engineering' }] })
    expect(
      readSourceSelectionLabels(googleDriveConnectorMeta, { ...config, _sourceLabels: {} })
    ).toEqual({})
    expect(
      describeSearchSource(googleDriveConnectorMeta, { ...config, _sourceLabels: metadata })
    ).toBe('Engineering')
  })
})
