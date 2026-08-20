/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { BitbucketBlock, BitbucketBlockMeta } from '@/blocks/blocks/bitbucket'
import { tools as toolRegistry } from '@/tools/registry'

vi.unmock('@/tools/registry')

const SOURCE_COMMIT_SHA = 'a'.repeat(40)
const PIPELINE_COMMIT_SHA = 'b'.repeat(40)
const TARGET_COMMIT_SHA = 'c'.repeat(40)

const EXPECTED_TOOL_IDS = [
  'bitbucket_list_workspaces',
  'bitbucket_list_repositories',
  'bitbucket_get_repository',
  'bitbucket_list_branches',
  'bitbucket_create_branch',
  'bitbucket_delete_branch',
  'bitbucket_list_commits',
  'bitbucket_get_commit',
  'bitbucket_list_directory',
  'bitbucket_get_file_metadata',
  'bitbucket_get_file',
  'bitbucket_list_pull_requests',
  'bitbucket_get_pull_request',
  'bitbucket_create_pull_request',
  'bitbucket_merge_pull_request',
  'bitbucket_get_pull_request_merge_task_status',
  'bitbucket_decline_pull_request',
  'bitbucket_approve_pull_request',
  'bitbucket_request_pull_request_changes',
  'bitbucket_get_pull_request_diff',
  'bitbucket_get_pull_request_diffstat',
  'bitbucket_list_pull_request_comments',
  'bitbucket_create_pull_request_comment',
  'bitbucket_list_pull_request_commit_statuses',
  'bitbucket_list_pipelines',
  'bitbucket_get_pipeline',
  'bitbucket_trigger_pipeline',
  'bitbucket_stop_pipeline',
  'bitbucket_list_pipeline_steps',
  'bitbucket_get_pipeline_step_log',
] as const

const SAMPLE_VALUES: Record<string, unknown> = {
  oauthCredential: 'credential-1',
  workspaceSlug: 'acme',
  repoSlug: 'platform',
  pageLen: '25',
  nextUrl: 'https://api.bitbucket.org/2.0/example?page=2',
  query: 'state = "OPEN"',
  sort: '-updated_on',
  administrator: 'true',
  role: 'contributor',
  branchName: 'feature/review',
  target: SOURCE_COMMIT_SHA,
  revision: SOURCE_COMMIT_SHA,
  path: 'src/index.ts',
  state: 'OPEN',
  prId: '42',
  title: 'Improve pipeline diagnostics',
  sourceBranch: 'feature/review',
  destinationBranch: 'main',
  description: 'Adds bounded log diagnostics.',
  reviewerAccountIds: '{reviewer-a}, {reviewer-b}',
  createCloseSourceBranch: 'true',
  mergeCloseSourceBranch: 'true',
  draft: 'true',
  mergeStrategy: 'squash',
  message: 'Merge pull request 42',
  taskId: 'task-1',
  content: 'Looks good after the test fix.',
  parentId: '7',
  pipelineRefType: 'BRANCH',
  pipelineRefName: 'main',
  pipelineCommitHash: PIPELINE_COMMIT_SHA,
  pipelineSelectorType: 'BRANCH',
  pipelineSelectorPattern: 'main',
  pipelineTriggerType: 'MANUAL',
  pipelineStatus: 'FAILED',
  pipelineUuid: '{pipeline-uuid}',
  targetRef: 'main',
  targetCommitHash: TARGET_COMMIT_SHA,
  stepUuid: '{step-uuid}',
  maxCharacters: '65536',
}

type BitbucketOperation = (typeof EXPECTED_TOOL_IDS)[number]

function mapBlockParams(
  operation: BitbucketOperation,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const mapper = BitbucketBlock.tools.config?.params
  if (!mapper) throw new Error('Bitbucket block is missing tools.config.params')
  return mapper({ operation, ...SAMPLE_VALUES, ...overrides }) as Record<string, unknown>
}

function buildRequestUrl(
  operation: BitbucketOperation,
  overrides: Record<string, unknown> = {}
): string {
  const toolId = BitbucketBlock.tools.config?.tool({ operation })
  if (!toolId) throw new Error(`Bitbucket operation ${operation} did not resolve to a tool`)
  const url = toolRegistry[toolId].request.url
  if (typeof url !== 'function') return url
  return url({ ...mapBlockParams(operation, overrides), accessToken: 'oauth-token' } as never)
}

function buildRequestBody(
  operation: BitbucketOperation,
  overrides: Record<string, unknown> = {}
): unknown {
  const toolId = BitbucketBlock.tools.config?.tool({ operation })
  if (!toolId) throw new Error(`Bitbucket operation ${operation} did not resolve to a tool`)
  const body = toolRegistry[toolId].request.body
  if (!body) throw new Error(`Bitbucket tool ${toolId} is missing request.body`)
  return body({ ...mapBlockParams(operation, overrides), accessToken: 'oauth-token' } as never)
}

describe('BitbucketBlock', () => {
  it('exposes every Bitbucket action one-to-one through the operation dropdown', () => {
    const operation = BitbucketBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const options =
      typeof operation?.options === 'function' ? operation.options() : operation?.options

    expect(options?.map((option) => option.id).sort()).toEqual([...EXPECTED_TOOL_IDS].sort())
    expect([...BitbucketBlock.tools.access].sort()).toEqual([...EXPECTED_TOOL_IDS].sort())
    expect(new Set(options?.map((option) => option.id)).size).toBe(EXPECTED_TOOL_IDS.length)
  })

  it.each(EXPECTED_TOOL_IDS)('%s resolves to a registered tool', (operation) => {
    const toolId = BitbucketBlock.tools.config?.tool({ operation })
    expect(toolId).toBe(operation)
    expect(toolRegistry[toolId]).toBeDefined()
  })

  it.each(EXPECTED_TOOL_IDS)('%s supplies every required user-facing tool param', (operation) => {
    const toolId = BitbucketBlock.tools.config?.tool({ operation }) as string
    const mapped = BitbucketBlock.tools.config?.params?.({ operation, ...SAMPLE_VALUES }) ?? {}
    const required = Object.entries(toolRegistry[toolId].params ?? {})
      .filter(([id, config]) => config.required && id !== 'accessToken')
      .map(([id]) => id)

    expect(required.filter((id) => mapped[id] === undefined || mapped[id] === '')).toEqual([])
  })

  it.each(EXPECTED_TOOL_IDS)('%s maps every non-hidden tool parameter', (operation) => {
    const toolId = BitbucketBlock.tools.config?.tool({ operation }) as string
    const mapped = BitbucketBlock.tools.config?.params?.({ operation, ...SAMPLE_VALUES }) ?? {}
    const exposed = Object.entries(toolRegistry[toolId].params ?? {})
      .filter(([id, config]) => id !== 'accessToken' && config.visibility !== 'hidden')
      .map(([id]) => id)

    expect(exposed.filter((id) => mapped[id] === undefined)).toEqual([])
  })

  it.each(EXPECTED_TOOL_IDS)('%s does not emit unsupported execution params', (operation) => {
    const toolId = BitbucketBlock.tools.config?.tool({ operation }) as string
    const mapped = BitbucketBlock.tools.config?.params?.({ operation, ...SAMPLE_VALUES }) ?? {}
    const accepted = new Set([...Object.keys(toolRegistry[toolId].params ?? {}), 'oauthCredential'])

    expect(Object.keys(mapped).filter((key) => !accepted.has(key))).toEqual([])
  })

  it.each(EXPECTED_TOOL_IDS)('%s exposes every tool output through the block', (operation) => {
    const toolOutputs = Object.keys(toolRegistry[operation].outputs ?? {})
    const blockOutputs = new Set(Object.keys(BitbucketBlock.outputs))

    expect(toolOutputs.filter((key) => !blockOutputs.has(key))).toEqual([])
  })

  it('uses canonical picker/manual pairs without colliding with visual subblock IDs', () => {
    const expectedPairs = {
      oauthCredential: ['accountPicker', 'credentialIdInput'],
      workspaceSlug: ['workspacePicker', 'workspaceSlugInput'],
      repoSlug: ['repositoryPicker', 'repositorySlugInput'],
    }

    for (const [canonicalParamId, ids] of Object.entries(expectedPairs)) {
      const members = BitbucketBlock.subBlocks.filter(
        (subBlock) => subBlock.canonicalParamId === canonicalParamId
      )
      expect(members.map((member) => member.id).sort()).toEqual([...ids].sort())
      expect(members.filter((member) => member.mode === 'basic')).toHaveLength(1)
      expect(members.filter((member) => member.mode === 'advanced')).toHaveLength(1)
      expect(members[0].required).toEqual(members[1].required)
      expect(members[0].condition).toEqual(members[1].condition)
      expect(BitbucketBlock.subBlocks.some((member) => member.id === canonicalParamId)).toBe(false)
    }

    expect(
      BitbucketBlock.subBlocks.find((member) => member.id === 'workspacePicker')?.dependsOn
    ).toEqual(['accountPicker'])
    expect(
      BitbucketBlock.subBlocks.find((member) => member.id === 'workspaceSlugInput')?.dependsOn
    ).toEqual(['credentialIdInput'])
    expect(
      BitbucketBlock.subBlocks.find((member) => member.id === 'repositoryPicker')?.dependsOn
    ).toEqual(['accountPicker', 'workspacePicker'])
    expect(
      BitbucketBlock.subBlocks.find((member) => member.id === 'repositorySlugInput')?.dependsOn
    ).toEqual(['credentialIdInput', 'workspaceSlugInput'])
  })

  it('coerces execution values and fixes pipeline triggering to a branch ref target', () => {
    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_create_pull_request',
        ...SAMPLE_VALUES,
      })
    ).toMatchObject({
      reviewerUuids: ['{reviewer-a}', '{reviewer-b}'],
      closeSourceBranch: true,
    })

    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_trigger_pipeline',
        ...SAMPLE_VALUES,
      })
    ).toMatchObject({ refType: 'branch', refName: 'main' })

    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_list_repositories',
        ...SAMPLE_VALUES,
      })
    ).toMatchObject({ pageLen: 25 })

    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_get_pull_request_diff',
        ...SAMPLE_VALUES,
      })
    ).toMatchObject({ prId: 42, path: 'src/index.ts', maxCharacters: 65536 })

    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_get_file_metadata',
        ...SAMPLE_VALUES,
      })
    ).toMatchObject({ commit: SOURCE_COMMIT_SHA, path: 'src/index.ts' })

    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_get_pull_request_merge_task_status',
        ...SAMPLE_VALUES,
      })
    ).toMatchObject({ prId: 42, taskId: 'task-1' })
  })

  it.each([undefined, null, '', '   '])(
    'treats %p as omission across optional execution value kinds',
    (value) => {
      expect(
        mapBlockParams('bitbucket_create_pull_request_comment', { parentId: value }).parentId
      ).toBeUndefined()
      expect(
        mapBlockParams('bitbucket_create_pull_request', { draft: value }).draft
      ).toBeUndefined()
      expect(
        mapBlockParams('bitbucket_create_pull_request', { description: value }).description
      ).toBeUndefined()
      expect(mapBlockParams('bitbucket_list_branches', { query: value }).q).toBeUndefined()
      expect(
        mapBlockParams('bitbucket_create_pull_request', { reviewerAccountIds: value }).reviewerUuids
      ).toBeUndefined()
    }
  )

  it('coerces canonical positive integer strings and reaches the real tool URL', () => {
    expect(buildRequestUrl('bitbucket_decline_pull_request', { prId: '42' })).toMatch(
      /\/pullrequests\/42\/decline$/
    )
  })

  it.each([
    true,
    false,
    [7],
    { value: 7 },
    0,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    'false',
    ' 42 ',
    '01',
    '7.0',
    '1e2',
    '-1',
  ])('rejects malformed PR ids before a mutation request is built: %p', (prId) => {
    expect(() => buildRequestUrl('bitbucket_decline_pull_request', { prId })).toThrow(/prId/)
  })

  it('does not let a create-pull-request close setting reach a merge', () => {
    const merged = buildRequestBody('bitbucket_merge_pull_request', {
      createCloseSourceBranch: 'true',
      mergeCloseSourceBranch: '',
    }) as Record<string, unknown>
    expect(merged).not.toHaveProperty('close_source_branch')

    const created = buildRequestBody('bitbucket_create_pull_request', {
      createCloseSourceBranch: '',
      mergeCloseSourceBranch: 'true',
    }) as Record<string, unknown>
    expect(created).not.toHaveProperty('close_source_branch')
  })

  it('does not turn a malformed optional parent ID into a top-level comment', () => {
    expect(() =>
      buildRequestBody('bitbucket_create_pull_request_comment', { parentId: { id: 7 } })
    ).toThrow(/parentId/)
  })

  it('preserves explicit false booleans and rejects other present boolean shapes', () => {
    expect(
      buildRequestBody('bitbucket_create_pull_request', {
        createCloseSourceBranch: false,
        draft: 'false',
      })
    ).toMatchObject({ close_source_branch: false, draft: false })

    for (const draft of [0, 1, 'yes', ' false ', [], {}]) {
      expect(
        () => mapBlockParams('bitbucket_create_pull_request', { draft }),
        String(draft)
      ).toThrow(/draft/)
    }
  })

  it('validates reviewer lists atomically instead of filtering malformed elements', () => {
    expect(
      mapBlockParams('bitbucket_create_pull_request', {
        reviewerAccountIds: [' {reviewer-a} ', '{reviewer-b}'],
      }).reviewerUuids
    ).toEqual(['{reviewer-a}', '{reviewer-b}'])
    expect(
      mapBlockParams('bitbucket_create_pull_request', { reviewerAccountIds: [] }).reviewerUuids
    ).toEqual([])

    for (const reviewerAccountIds of [
      ['{reviewer-a}', 7],
      ['{reviewer-a}', '   '],
      '{reviewer-a},, {reviewer-b}',
      { uuid: '{reviewer-a}' },
    ]) {
      expect(
        () => mapBlockParams('bitbucket_create_pull_request', { reviewerAccountIds }),
        JSON.stringify(reviewerAccountIds)
      ).toThrow(/reviewerAccountIds/)
    }
  })

  it('rejects malformed present string values instead of silently omitting them', () => {
    expect(() => mapBlockParams('bitbucket_list_branches', { query: false })).toThrow(/query/)
    expect(() => mapBlockParams('bitbucket_create_pull_request', { description: {} })).toThrow(
      /description/
    )
  })

  it('preserves meaningful whitespace in repository paths and authored text', () => {
    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_get_file',
        ...SAMPLE_VALUES,
        path: ' docs/release notes.md ',
      })
    ).toMatchObject({ path: ' docs/release notes.md ' })

    expect(
      BitbucketBlock.tools.config?.params?.({
        operation: 'bitbucket_create_pull_request_comment',
        ...SAMPLE_VALUES,
        content: '  indented Markdown\n',
      })
    ).toMatchObject({ content: '  indented Markdown\n' })
  })

  it('covers every action with a canvas sentence and declares no trigger support', () => {
    const sentences = BitbucketBlock.canvasPresentation?.sentences?.byOperation ?? {}
    expect(Object.keys(sentences).sort()).toEqual([...EXPECTED_TOOL_IDS].sort())
    expect(BitbucketBlock.triggerAllowed).toBeUndefined()
    expect(BitbucketBlock.triggers).toBeUndefined()
    expect(BitbucketBlockMeta.tags).not.toContain('webhooks')
  })
})
