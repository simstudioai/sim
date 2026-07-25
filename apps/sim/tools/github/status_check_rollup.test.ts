/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { statusCheckRollupTool } from '@/tools/github/status_check_rollup'
import type { StatusCheckRollupParams } from '@/tools/github/types'

const SHA = 'a'.repeat(40)

const BASE_PARAMS: StatusCheckRollupParams = {
  owner: 'octo',
  repo: 'demo',
  sha: SHA,
  pullNumber: 7,
  apiKey: 'ghp_test',
}

function rollupPayload(nodes: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    data: {
      repository: {
        object: {
          __typename: 'Commit',
          statusCheckRollup: {
            state: 'FAILURE',
            contexts: {
              totalCount: nodes.length,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes,
              ...overrides,
            },
          },
        },
      },
    },
  }
}

/** An Actions check run: GitHub Actions leaves the whole `output` block null. */
function actionsCheckRun(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'CheckRun',
    name: 'ci / test',
    status: 'COMPLETED',
    conclusion: 'FAILURE',
    detailsUrl: 'https://github.com/octo/demo/actions/runs/1/job/2',
    databaseId: 2,
    isRequired: true,
    output: null,
    ...overrides,
  }
}

function statusContext(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'StatusContext',
    context: 'vercel',
    state: 'SUCCESS',
    description: 'Deployment has completed',
    targetUrl: 'https://vercel.com/octo/demo',
    isRequired: false,
    ...overrides,
  }
}

async function parse(payload: unknown, params: StatusCheckRollupParams = BASE_PARAMS) {
  return statusCheckRollupTool.transformResponse!(Response.json(payload), params)
}

describe('github_status_check_rollup', () => {
  it('pins the read to a commit SHA and to the pull request that decides requiredness', () => {
    const body = statusCheckRollupTool.request.body!({ ...BASE_PARAMS, cursor: 'CURSOR_1' }) as {
      query: string
      variables: Record<string, unknown>
    }

    expect(body.query).toContain('object(oid: $sha)')
    expect(body.query).toContain('isRequired(pullRequestNumber: $number)')
    expect(body.query).toContain('contexts(first: 100, after: $cursor)')
    expect(body.variables).toEqual({
      owner: 'octo',
      repo: 'demo',
      sha: SHA,
      number: 7,
      cursor: 'CURSOR_1',
    })
  })

  it('parses a check run whose output block is entirely null', async () => {
    const result = await parse(rollupPayload([actionsCheckRun()]))

    expect(result.success).toBe(true)
    expect(result.output.contexts).toEqual([
      {
        __typename: 'CheckRun',
        name: 'ci / test',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: 'https://github.com/octo/demo/actions/runs/1/job/2',
        databaseId: 2,
        isRequired: true,
        output: null,
      },
    ])
  })

  it('parses every legitimately-null field rather than demanding a string', async () => {
    const result = await parse(
      rollupPayload([
        actionsCheckRun({
          status: 'QUEUED',
          conclusion: null,
          detailsUrl: null,
          databaseId: null,
          isRequired: null,
          output: { title: null, summary: null },
        }),
        statusContext({ description: null, targetUrl: null }),
      ])
    )

    expect(result.output.contexts[0]).toMatchObject({
      conclusion: null,
      detailsUrl: null,
      databaseId: null,
      isRequired: null,
      output: { title: null, summary: null },
    })
    expect(result.output.contexts[1]).toMatchObject({ description: null, targetUrl: null })
  })

  it('keeps a third-party app output that is actually populated', async () => {
    const result = await parse(
      rollupPayload([
        actionsCheckRun({
          name: 'codecov/patch',
          output: { title: '80% of diff hit', summary: 'Coverage dropped' },
        }),
      ])
    )

    expect(result.output.contexts[0]).toMatchObject({
      output: { title: '80% of diff hit', summary: 'Coverage dropped' },
    })
  })

  it('carries the pagination signals a caller needs to detect truncation', async () => {
    const result = await parse(
      rollupPayload([actionsCheckRun()], {
        totalCount: 31,
        pageInfo: { hasNextPage: true, endCursor: 'CURSOR_2' },
      })
    )

    expect(result.output).toMatchObject({
      state: 'FAILURE',
      totalCount: 31,
      hasNextPage: true,
      endCursor: 'CURSOR_2',
    })
    expect(result.output.contexts).toHaveLength(1)
  })

  it('reports a commit with no checks as a null state and no contexts', async () => {
    const result = await parse({
      data: { repository: { object: { __typename: 'Commit', statusCheckRollup: null } } },
    })

    expect(result.output).toEqual({
      state: null,
      totalCount: 0,
      hasNextPage: false,
      endCursor: null,
      contexts: [],
    })
  })

  it('fails rather than reporting no checks when the commit is unknown', async () => {
    await expect(parse({ data: { repository: { object: null } } })).rejects.toThrow(
      new RegExp(`Commit ${SHA} was not found`)
    )
  })

  it('fails on a GraphQL error payload delivered with HTTP 200', async () => {
    await expect(
      parse({
        data: { repository: null },
        errors: [{ message: 'Resource not accessible by integration' }],
      })
    ).rejects.toThrow(/Resource not accessible by integration/)
  })

  it('stops on a context type it does not know how to read', async () => {
    await expect(parse(rollupPayload([{ __typename: 'FutureCheckKind' }]))).rejects.toThrow(
      /unsupported type "FutureCheckKind"/
    )
  })
})
