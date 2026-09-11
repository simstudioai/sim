/** @vitest-environment jsdom */
import { act, type ReactNode, useState } from 'react'
import { ChipModal, ChipModalBody, ChipModalField, ChipModalHeader } from '@sim/emcn'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GitLabPermissionData,
  GitLabPermissionUploadInput,
} from '@/lib/api/contracts/knowledge/gitlab-permissions'
import {
  GitLabPermissionTabs,
  GitLabPermissionUploads,
} from '@/connectors/gitlab/permission-config/fields'
import { useGitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'

interface HarnessProps {
  saved?: GitLabPermissionData
  submit: (input: GitLabPermissionUploadInput) => void
}

function Harness({ saved, submit }: HarnessProps) {
  const form = useGitLabPermissionForm(saved)
  const [project, setProject] = useState('group/project')
  return (
    <ChipModal open onOpenChange={() => {}} srTitle='Configure GitLab'>
      <ChipModalHeader>Configure GitLab</ChipModalHeader>
      <ChipModalBody>
        <GitLabPermissionTabs form={form} />
        <ChipModalField
          type='input'
          title='Personal Access Token'
          inputType='password'
          value={form.apiKey}
          onChange={form.setApiKey}
        />
        <ChipModalField type='input' title='Project' value={project} onChange={setProject} />
        <GitLabPermissionUploads form={form} />
        <button type='button' disabled={!form.complete} onClick={() => submit(form.input)}>
          Save
        </button>
      </ChipModalBody>
    </ChipModal>
  )
}

let root: Root
let container: HTMLDivElement
async function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
function input(label: string): HTMLInputElement {
  const labelled = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (labelled) return labelled
  const fieldLabel = Array.from(document.querySelectorAll('label')).find(
    (node) => node.textContent === label
  )
  const node = fieldLabel ? document.getElementById(fieldLabel.htmlFor) : null
  if (!(node instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`)
  return node
}
async function click(label: string) {
  await act(async () => {
    button(label).click()
  })
}
async function change(label: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input(label),
      value
    )
    input(label).dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function upload(label: string, content: string, filename = 'upload.csv') {
  const file = new File([content], filename, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(content).buffer,
  })
  await act(async () => {
    Object.defineProperty(input(label), 'files', { value: [file], configurable: true })
    input(label).dispatchEvent(new Event('change', { bubbles: true }))
  })
}
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  vi.restoreAllMocks()
})

describe('GitLab permission setup modal', () => {
  it('preserves shared inputs across keyboard tab changes and requires both uploads', async () => {
    const submit = vi.fn()
    await render(<Harness submit={submit} />)
    await change('Personal Access Token', 'fixture-pat')
    await change('Project', 'team/docs')
    const admin = button('Administrator token')
    admin.focus()
    await act(async () => {
      admin.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await sleep(1)
    })
    expect(button('Non-admin token').getAttribute('aria-checked')).toBe('true')
    expect(button('Save').disabled).toBe(true)
    await upload('User mapping', 'user_id,email\n1,alice@example.com')
    await upload('Project permissions', 'team/docs,1')
    expect(button('Save').disabled).toBe(false)
    await click('Administrator token')
    await click('Non-admin token')
    expect(input('Project').value).toBe('team/docs')
    expect(input('Personal Access Token').value).toBe('fixture-pat')
    await click('Save')
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gitlab',
        mode: 'csv',
        userMapping: expect.objectContaining({
          content: expect.stringContaining('alice@example.com'),
        }),
        projectPermissions: expect.objectContaining({ content: 'team/docs,1' }),
      })
    )
  })

  it('shows inline validation and supplies both exact CSV templates', async () => {
    const templates: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      templates.push(decodeURIComponent(this.href.split(',')[1]))
    })
    await render(<Harness submit={vi.fn()} />)
    await click('Non-admin token')
    for (const node of document.querySelectorAll<HTMLButtonElement>('button'))
      if (node.textContent === 'Download template') await act(async () => node.click())
    expect(templates).toEqual([
      'user_id,email\n123,alice@example.com\n',
      'project_path,user_id\ngroup/project,123\n',
    ])
    await upload('User mapping', '1,a@example.com\n1,b@example.com')
    expect(document.body.textContent).toContain('conflicts with another identity mapping')
    expect(button('Save').disabled).toBe(true)
    expect(document.body.textContent).toContain(
      'Confidential issues and their comments are excluded'
    )
  })

  it('replaces one saved file and submits the revision without resending the other file', async () => {
    const submit = vi.fn()
    await render(
      <Harness
        submit={submit}
        saved={{
          provider: 'gitlab',
          mode: 'csv',
          revision: 7,
          userMapping: {
            filename: 'saved-users.csv',
            uploadedAt: '2026-09-10T00:00:00.000Z',
            rowCount: 2,
          },
          projectPermissions: {
            filename: 'saved-projects.csv',
            uploadedAt: '2026-09-10T00:00:00.000Z',
            rowCount: 3,
          },
        }}
      />
    )
    expect(document.body.textContent).toContain('saved-projects.csv')
    await upload('User mapping', '1,new@example.com', 'replacement.csv')
    expect(document.body.textContent).toMatch(/replacement.csv.*Ready to save/)
    await click('Save')
    expect(submit).toHaveBeenCalledWith({
      provider: 'gitlab',
      mode: 'csv',
      expectedRevision: 7,
      userMapping: { filename: 'replacement.csv', content: '1,new@example.com' },
      projectPermissions: undefined,
    })
  })
})
