/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import type { ChipSelectProps } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalField: ({
    children,
  }: {
    children: ReactNode | ((aria: { 'aria-required'?: boolean }) => ReactNode)
  }) => (
    <div>{typeof children === 'function' ? children({ 'aria-required': true }) : children}</div>
  ),
  ChipModalHeader: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ChipModalFooter: ({
    onCancel,
    primaryAction,
  }: {
    onCancel: () => void
    primaryAction: { label: string; onClick: () => void; disabled?: boolean }
  }) => (
    <div>
      <button type='button' onClick={onCancel}>
        Cancel
      </button>
      <button type='button' onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
        {primaryAction.label}
      </button>
    </div>
  ),
  ChipSelect: (props: ChipSelectProps) => (
    <div>
      {props.options?.map((option) => (
        <button
          key={option.value}
          type='button'
          aria-pressed={
            props.multiSelect
              ? props.multiSelectValues?.includes(option.value)
              : props.value === option.value
          }
          onClick={() => {
            if (props.multiSelect) {
              const values = props.multiSelectValues ?? []
              props.onMultiSelectChange?.(
                values.includes(option.value)
                  ? values.filter((id) => id !== option.value)
                  : [...values, option.value]
              )
            } else props.onChange?.(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

import { CredentialGroupAddResourceModal } from '@/ee/credential-groups/components/credential-group-add-resource-modal'

const mountedRoots: Root[] = []

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

it('requires one workflow and returns the canonical selected ID', () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  const onAdd = vi.fn()
  const onClose = vi.fn()
  act(() =>
    root.render(
      <CredentialGroupAddResourceModal
        resourceType='workflow'
        resources={[{ id: 'workflow-1', name: 'Finance workflow' }]}
        disabled={false}
        onAdd={onAdd}
        onClose={onClose}
      />
    )
  )
  const button = (label: string) => {
    const match = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!(match instanceof HTMLButtonElement)) throw new Error(`Button ${label} not found`)
    return match
  }

  expect(button('Add workflow').disabled).toBe(true)
  act(() => button('Finance workflow').click())
  expect(button('Add workflow').disabled).toBe(false)
  act(() => button('Add workflow').click())

  expect(onAdd).toHaveBeenCalledWith('workflow-1')
  expect(onClose).not.toHaveBeenCalled()
})

it('adds multiple selected workspaces together and excludes deselected workspaces', () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  const onAdd = vi.fn()
  const onClose = vi.fn()
  act(() =>
    root.render(
      <CredentialGroupAddResourceModal
        resourceType='workspace'
        resources={[
          { id: 'workspace-1', name: 'Finance' },
          { id: 'workspace-2', name: 'Support' },
          { id: 'workspace-3', name: 'Sales' },
        ]}
        disabled={false}
        onAdd={onAdd}
        onClose={onClose}
      />
    )
  )
  const button = (label: string) => {
    const match = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    )
    if (!match) throw new Error(`Button ${label} not found`)
    return match
  }

  expect(button('Add workspaces').disabled).toBe(true)
  act(() => button('Finance').click())
  act(() => button('Support').click())
  act(() => button('Sales').click())
  act(() => button('Support').click())
  expect(onAdd).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(button('Finance').getAttribute('aria-pressed')).toBe('true')
  expect(button('Sales').getAttribute('aria-pressed')).toBe('true')
  expect(button('Support').getAttribute('aria-pressed')).toBe('false')

  act(() => button('Add workspaces').click())
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(['workspace-1', 'workspace-3'])
  expect(onClose).not.toHaveBeenCalled()
})
