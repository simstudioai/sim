/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { DaytonaBlock } from '@/blocks/blocks/daytona'
import { daytonaGitCloneTool } from '@/tools/daytona/git_clone'

function gitCloneBody(args: Record<string, unknown>) {
  const mapped = DaytonaBlock.tools.config?.params?.(args, { operation: 'git_clone' }) ?? {}
  const body = daytonaGitCloneTool.request.body
  if (typeof body !== 'function') throw new Error('git_clone has no body builder')
  return body({ ...args, ...mapped } as never)
}

describe('Daytona git clone on an Agent tool call', () => {
  it('sends the repository and path stored on the tool row', () => {
    expect(
      gitCloneBody({
        apiKey: 'key',
        sandboxId: 'sb-1',
        repoUrl: 'https://github.com/acme/app.git',
        clonePath: '/home/daytona/app',
      })
    ).toMatchObject({ url: 'https://github.com/acme/app.git', path: '/home/daytona/app' })
  })

  it('keeps the repository and path the model supplied', () => {
    expect(
      gitCloneBody({
        apiKey: 'key',
        sandboxId: 'sb-1',
        url: 'https://github.com/acme/model.git',
        path: '/home/daytona/model',
      })
    ).toMatchObject({ url: 'https://github.com/acme/model.git', path: '/home/daytona/model' })
  })
})
