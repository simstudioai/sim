import { expect, it } from 'vitest'
import { renderingLock } from '#design-diff/infrastructure'
import { compareFiles, config } from '#design-diff/tests/helpers'

const lock = (react: string, scheduler: string, backend: string) =>
  JSON.stringify({
    packages: {
      react: [`react@${react}`, '', { dependencies: { scheduler: '1' } }, 'hash'],
      scheduler: [`scheduler@${scheduler}`, '', {}, 'hash'],
      redis: [`redis@${backend}`, '', {}, 'hash'],
    },
  })

it('ignores unrelated lock changes and retains rendering transitive changes', async () => {
  const a = lock('19', '1', '1')
  expect(renderingLock(a, config.renderingDependencies)).toEqual(
    renderingLock(lock('19', '1', '2'), config.renderingDependencies)
  )
  expect(renderingLock(a, config.renderingDependencies)).not.toEqual(
    renderingLock(lock('19', '2', '1'), config.renderingDependencies)
  )
  expect(
    (await compareFiles({ 'bun.lock': a }, { 'bun.lock': lock('19', '1', '2') })).flagged
  ).toBe(false)
  expect(
    (await compareFiles({ 'bun.lock': a }, { 'bun.lock': lock('19', '2', '1') })).flagged
  ).toBe(true)
})

it('retains uncertainty for unsupported lockfile formats without executing content', () => {
  expect(
    renderingLock('throw new Error("do not execute")', config.renderingDependencies)
  ).toMatchObject({ $unresolved: 'Malformed or unsupported Bun lockfile' })
})
