/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getDependsOnFields,
  getSubBlocksDependingOnChange,
  getTransitiveSubBlockDependents,
} from '@/lib/workflows/subblocks/dependencies'
import type { SubBlockConfig } from '@/blocks/types'

describe('getDependsOnFields', () => {
  it('returns an empty array when dependsOn is unset', () => {
    expect(getDependsOnFields(undefined)).toEqual([])
  })

  it('returns array dependencies unchanged', () => {
    expect(getDependsOnFields(['credential', 'projectId'])).toEqual(['credential', 'projectId'])
  })

  it('flattens all and any dependencies', () => {
    expect(getDependsOnFields({ all: ['credential'], any: ['teamId', 'manualTeamId'] })).toEqual([
      'credential',
      'teamId',
      'manualTeamId',
    ])
  })
})

describe('getSubBlocksDependingOnChange', () => {
  it('finds direct dependents of a changed subblock', () => {
    const subBlocks: SubBlockConfig[] = [
      { id: 'provider', title: 'Provider', type: 'dropdown' },
      { id: 'model', title: 'Model', type: 'dropdown', dependsOn: ['provider'] },
      { id: 'prompt', title: 'Prompt', type: 'long-input' },
    ]

    expect(
      getSubBlocksDependingOnChange(subBlocks, 'provider').map((subBlock) => subBlock.id)
    ).toEqual(['model'])
  })

  it('matches dependents through canonical basic and advanced siblings', () => {
    const subBlocks: SubBlockConfig[] = [
      {
        id: 'channel',
        title: 'Channel',
        type: 'channel-selector',
        canonicalParamId: 'channelId',
        mode: 'basic',
      },
      {
        id: 'manualChannel',
        title: 'Channel ID',
        type: 'short-input',
        canonicalParamId: 'channelId',
        mode: 'advanced',
      },
      {
        id: 'messageId',
        title: 'Message ID',
        type: 'short-input',
        dependsOn: ['channelId'],
      },
      {
        id: 'threadTs',
        title: 'Thread Timestamp',
        type: 'short-input',
        dependsOn: ['otherField'],
      },
    ]

    expect(
      getSubBlocksDependingOnChange(subBlocks, 'manualChannel').map((subBlock) => subBlock.id)
    ).toEqual(['messageId'])
    expect(
      getSubBlocksDependingOnChange(subBlocks, 'channel').map((subBlock) => subBlock.id)
    ).toEqual(['messageId'])
  })

  it('matches object-form dependencies when any listed dependency changes', () => {
    const subBlocks: SubBlockConfig[] = [
      { id: 'credential', title: 'Credential', type: 'oauth-input' },
      { id: 'teamId', title: 'Team', type: 'short-input' },
      {
        id: 'projectId',
        title: 'Project',
        type: 'short-input',
        dependsOn: { all: ['credential'], any: ['teamId'] },
      },
    ]

    expect(
      getSubBlocksDependingOnChange(subBlocks, 'credential').map((subBlock) => subBlock.id)
    ).toEqual(['projectId'])
    expect(
      getSubBlocksDependingOnChange(subBlocks, 'teamId').map((subBlock) => subBlock.id)
    ).toEqual(['projectId'])
  })
})

describe('getTransitiveSubBlockDependents', () => {
  it('returns transitive dependents without cycling', () => {
    const subBlocks: SubBlockConfig[] = [
      { id: 'credential', title: 'Credential', type: 'oauth-input' },
      { id: 'project', title: 'Project', type: 'project-selector', dependsOn: ['credential'] },
      { id: 'issue', title: 'Issue', type: 'file-selector', dependsOn: ['project'] },
      { id: 'assignee', title: 'Assignee', type: 'user-selector', dependsOn: ['issue'] },
      { id: 'unrelated', title: 'Unrelated', type: 'short-input' },
    ]

    expect(getTransitiveSubBlockDependents(subBlocks, ['credential'])).toEqual([
      { subBlockId: 'project', reason: 'project depends on credential' },
      { subBlockId: 'issue', reason: 'issue depends on project' },
      { subBlockId: 'assignee', reason: 'assignee depends on issue' },
    ])
  })

  it('walks multiple changed roots once', () => {
    const subBlocks: SubBlockConfig[] = [
      { id: 'credential', title: 'Credential', type: 'oauth-input' },
      { id: 'domain', title: 'Domain', type: 'short-input' },
      {
        id: 'project',
        title: 'Project',
        type: 'project-selector',
        dependsOn: ['credential', 'domain'],
      },
      { id: 'issue', title: 'Issue', type: 'file-selector', dependsOn: ['project'] },
    ]

    expect(getTransitiveSubBlockDependents(subBlocks, ['credential', 'domain'])).toEqual([
      { subBlockId: 'project', reason: 'project depends on credential' },
      { subBlockId: 'issue', reason: 'issue depends on project' },
    ])
  })
})
