/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useGitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'

describe('GitLab permission file selection', () => {
  it('blocks an oversized combined upload and recovers when a file is replaced', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const root = createRoot(document.createElement('div'))
    let form: ReturnType<typeof useGitLabPermissionForm> | undefined
    function Probe() {
      form = useGitLabPermissionForm()
      return null
    }
    const current = () => {
      if (!form) throw new Error('Permission form was not mounted')
      return form
    }
    act(() => root.render(createElement(Probe)))
    const csv = (content: string, filename: string) =>
      Object.assign(new File([content], filename), {
        arrayBuffer: async () => new TextEncoder().encode(content).buffer,
      })
    try {
      act(() => current().setMode('csv'))
      const users = csv('1,a@example.test\n'.repeat(300_000), 'users.csv')
      const grants = csv('group/p,1\n'.repeat(490_000), 'projects.csv')
      expect(users.size + grants.size).toBeLessThan(10 * 1024 * 1024)
      await act(async () => {
        await current().selectFile('userMapping', users)
        await current().selectFile('projectPermissions', grants)
      })
      expect(current().files.userMapping?.error).toBeUndefined()
      expect(current().files.projectPermissions?.error).toBeUndefined()
      expect(current().complete).toBe(false)
      await act(async () => {
        await current().selectFile('projectPermissions', csv('group/project,1', 'projects.csv'))
      })
      expect(current().complete).toBe(true)
      act(() => current().reset())
      expect(current().files).toEqual({})
    } finally {
      act(() => root.unmount())
      vi.unstubAllGlobals()
    }
  })
})
