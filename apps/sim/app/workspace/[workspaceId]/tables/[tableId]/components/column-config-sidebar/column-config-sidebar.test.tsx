/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ComboboxOption {
  label: string
  value: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  onChange?: (value: string) => void
}

interface SelectOptionsEditorProps {
  options: Array<{ id: string; name: string }>
  onChange: (options: Array<{ id: string; name: string }>) => void
}

const {
  capturedComboboxes,
  capturedSelectEditor,
  mockAddColumn,
  mockUpdateColumn,
  mockUseTablesList,
} = vi.hoisted(() => ({
  capturedComboboxes: { current: [] as ComboboxProps[] },
  capturedSelectEditor: { current: null as SelectOptionsEditorProps | null },
  mockAddColumn: vi.fn(),
  mockUpdateColumn: vi.fn(),
  mockUseTablesList: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  ChipCombobox: (props: ComboboxProps) => {
    capturedComboboxes.current.push(props)
    return <div data-placeholder={props.placeholder} />
  },
  ChipInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  FieldDivider: () => <hr />,
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label htmlFor={props.htmlFor ?? 'test-field'} {...props}>
      {children}
    </label>
  ),
  Switch: ({ checked }: { checked?: boolean }) => (
    <button type='button' aria-pressed={checked}>
      Toggle
    </button>
  ),
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@sim/emcn/icons', () => ({
  PlayOutline: () => <svg />,
  X: () => <svg />,
}))

vi.mock('@/lib/table/column-types', () => ({
  ALL_COLUMN_TYPES: [
    { id: 'string', label: 'Text', icon: () => null },
    { id: 'select', label: 'Select', icon: () => null },
    { id: 'reference', label: 'Reference', icon: () => null },
  ],
  columnTypeOf: (type: string) => ({ supportsUnique: type !== 'select' }),
}))

vi.mock('@/hooks/queries/tables', () => ({
  useAddTableColumn: () => ({ isPending: false, mutateAsync: mockAddColumn }),
  useTablesList: mockUseTablesList,
  useUpdateColumn: () => ({ isPending: false, mutateAsync: mockUpdateColumn }),
}))

vi.mock('@/app/workspace/[workspaceId]/tables/[tableId]/components/select-field', () => ({
  SelectOptionsEditor: (props: SelectOptionsEditorProps) => {
    capturedSelectEditor.current = props
    return <div data-testid='select-options-editor' />
  },
}))

import { ColumnConfigSidebar } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/column-config-sidebar/column-config-sidebar'

let container: HTMLDivElement
let root: Root

function findCombobox(placeholder: string): ComboboxProps | undefined {
  return capturedComboboxes.current.find((combobox) => combobox.placeholder === placeholder)
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label
  )
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  capturedComboboxes.current = []
  capturedSelectEditor.current = null
  mockUseTablesList.mockReturnValue({
    data: [
      { id: 'table-current', name: 'Current table' },
      { id: 'table-customers', name: 'Customers' },
    ],
  })
  mockAddColumn.mockResolvedValue({ data: { columns: [] } })
  mockUpdateColumn.mockResolvedValue({ data: { columns: [] } })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('ColumnConfigSidebar', () => {
  it('creates a Reference column with the selected workspace table', async () => {
    await act(async () => {
      root.render(
        <ColumnConfigSidebar
          config={{ mode: 'create', proposedName: 'Related row', type: 'reference' }}
          onClose={vi.fn()}
          existingColumn={null}
          workspaceId='workspace-1'
          tableId='table-current'
        />
      )
    })

    expect(mockUseTablesList).toHaveBeenCalledWith('workspace-1', 'active', { enabled: true })
    expect(container.querySelector<HTMLInputElement>('#column-sidebar-name')?.value).toBe(
      'Related row'
    )
    expect(findCombobox('Select table')).toMatchObject({
      options: [
        { label: 'Current table', value: 'table-current' },
        { label: 'Customers', value: 'table-customers' },
      ],
      searchable: true,
      searchPlaceholder: 'Search tables',
    })

    act(() => findCombobox('Select table')?.onChange?.('table-customers'))
    await act(async () => findButton('Save')?.click())

    expect(mockAddColumn).toHaveBeenCalledWith({
      name: 'Related row',
      type: 'reference',
      referenceTableId: 'table-customers',
    })
  })

  it('edits Reference configuration without exposing column renaming', async () => {
    await act(async () => {
      root.render(
        <ColumnConfigSidebar
          config={{ mode: 'edit', columnName: 'col-reference' }}
          onClose={vi.fn()}
          existingColumn={{
            id: 'col-reference',
            name: 'Related row',
            type: 'reference',
            referenceTableId: 'table-current',
          }}
          workspaceId='workspace-1'
          tableId='table-current'
        />
      )
    })

    expect(container).not.toHaveTextContent('Column name')
    expect(container.querySelector('#column-sidebar-name')).toBeNull()

    act(() => findCombobox('Select table')?.onChange?.('table-customers'))
    await act(async () => findButton('Save')?.click())

    expect(mockUpdateColumn).toHaveBeenCalledWith({
      columnName: 'col-reference',
      updates: { referenceTableId: 'table-customers' },
    })
  })

  it('keeps Select options in the edit sidebar', async () => {
    await act(async () => {
      root.render(
        <ColumnConfigSidebar
          config={{ mode: 'edit', columnName: 'col-status' }}
          onClose={vi.fn()}
          existingColumn={{
            id: 'col-status',
            name: 'Status',
            type: 'select',
            options: [{ id: 'option-ready', name: 'Ready' }],
          }}
          workspaceId='workspace-1'
          tableId='table-current'
        />
      )
    })

    expect(container).toHaveTextContent('Options')
    expect(container).toHaveTextContent('Multiselect')
    act(() =>
      capturedSelectEditor.current?.onChange([
        { id: 'option-ready', name: 'Ready' },
        { id: 'option-done', name: 'Done' },
      ])
    )
    await act(async () => findButton('Save')?.click())

    expect(mockUpdateColumn).toHaveBeenCalledWith({
      columnName: 'col-status',
      updates: {
        options: [
          { id: 'option-ready', name: 'Ready' },
          { id: 'option-done', name: 'Done' },
        ],
      },
    })
  })
})
