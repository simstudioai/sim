/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Table } from './table'
import { TableIdentityCell } from './table-identity-cell'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

interface Member {
  id: string
  name: string
  email: string
  role: string
}

const members: Member[] = [
  { id: 'a', name: 'Ada Lovelace', email: 'ada@sim.ai', role: 'Owner' },
  { id: 'b', name: 'Grace Hopper', email: 'grace@sim.ai', role: 'Admin' },
  { id: 'c', name: 'Alan Turing', email: 'alan@sim.ai', role: 'Member' },
]

const columns = [
  {
    key: 'member',
    cell: (member: Member) => <TableIdentityCell primary={member.name} secondary={member.email} />,
  },
  { key: 'role', align: 'right' as const, cell: (member: Member) => member.role },
]

function headerCheckbox(): HTMLElement {
  const node = container?.querySelector('[aria-label="Select all rows"]')
  if (!(node instanceof HTMLElement)) throw new Error('missing header checkbox')
  return node
}

describe('Table', () => {
  it('renders one row per item with the identity cell', () => {
    mount(<Table rows={members} getRowId={(m) => m.id} columns={columns} />)
    expect(container?.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(container?.textContent).toContain('Ada Lovelace')
    expect(container?.textContent).toContain('ada@sim.ai')
  })

  it('labels the header Select all (N) when nothing is selected', () => {
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{
          selectedIds: [],
          onSelectionChange: vi.fn(),
          bulkActions: <button>Remove</button>,
        }}
      />
    )
    expect(container?.querySelector('thead')?.textContent).toContain('Select all (3)')
    expect(headerCheckbox().getAttribute('aria-checked')).toBe('false')
  })

  it('keeps bulk actions mounted with an empty selection so they can disable themselves', () => {
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{
          selectedIds: [],
          onSelectionChange: vi.fn(),
          bulkActions: <button disabled>Remove</button>,
        }}
      />
    )
    // Mounted-but-disabled, not absent: a control that appears only once a row is
    // ticked is undiscoverable, and its slot reflows the band as it comes and goes.
    expect(container?.querySelector('thead')?.textContent).toContain('Remove')
    expect(container?.querySelector('thead button[disabled]')).not.toBeNull()
  })

  it('switches to X selected of Y', () => {
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{
          selectedIds: ['a', 'b'],
          onSelectionChange: vi.fn(),
          bulkActions: <button>Remove</button>,
        }}
      />
    )
    expect(container?.querySelector('thead')?.textContent).toContain('2 selected of 3')
    expect(container?.querySelector('thead')?.textContent).toContain('Remove')
    expect(headerCheckbox().getAttribute('aria-checked')).toBe('mixed')
  })

  it('selects every row from the header, and clears them again', () => {
    const onSelectionChange = vi.fn()
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{ selectedIds: [], onSelectionChange }}
      />
    )
    act(() => headerCheckbox().click())
    expect(onSelectionChange).toHaveBeenCalledWith(['a', 'b', 'c'])

    act(() =>
      root?.render(
        <Table
          rows={members}
          getRowId={(m) => m.id}
          columns={columns}
          selection={{ selectedIds: ['a', 'b', 'c', 'off-screen'], onSelectionChange }}
        />
      )
    )
    expect(headerCheckbox().getAttribute('aria-checked')).toBe('true')
    act(() => headerCheckbox().click())
    expect(onSelectionChange).toHaveBeenLastCalledWith(['off-screen'])
  })

  it('toggles a single row', () => {
    const onSelectionChange = vi.fn()
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{ selectedIds: ['a'], onSelectionChange }}
      />
    )
    const rowCheckboxes = container?.querySelectorAll('tbody [aria-label="Select row"]')
    expect(rowCheckboxes).toHaveLength(3)
    act(() => (rowCheckboxes?.[1] as HTMLElement).click())
    expect(onSelectionChange).toHaveBeenCalledWith(['a', 'b'])
    act(() => (rowCheckboxes?.[0] as HTMLElement).click())
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })

  /**
   * A disabled checkbox is a faint outline that still reads as "unchecked", so a
   * list where several rows cannot be picked looked like select-all was broken:
   * the band said "4 selected of 4" with eight boxes on screen.
   */
  it('gives an unselectable row no checkbox, and counts only the selectable ones', () => {
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{
          selectedIds: [],
          onSelectionChange: vi.fn(),
          isRowSelectable: (m: Member) => m.role !== 'Owner',
        }}
      />
    )
    expect(container?.querySelectorAll('tbody [aria-label="Select row"]')).toHaveLength(2)
    expect(container?.querySelector('tbody [disabled]')).toBeNull()
    expect(container?.querySelector('thead')?.textContent).toContain('Select all (2)')
  })

  it('renders the empty slot instead of rows', () => {
    mount(
      <Table
        rows={[]}
        getRowId={(m: Member) => m.id}
        columns={columns}
        empty={<span>Nothing here</span>}
      />
    )
    expect(container?.textContent).toContain('Nothing here')
    expect(container?.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('renders tabs and reports selection', () => {
    const onChange = vi.fn()
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        tabs={{
          items: [
            { id: 'team', label: 'Team Members' },
            { id: 'pending', label: 'Pending Invitations' },
          ],
          activeId: 'team',
          onChange,
        }}
      />
    )
    const tabButtons = container?.querySelectorAll('[role="tab"]')
    expect(tabButtons).toHaveLength(2)
    expect(tabButtons?.[0].getAttribute('aria-selected')).toBe('true')
    act(() => (tabButtons?.[1] as HTMLElement).click())
    expect(onChange).toHaveBeenCalledWith('pending')
  })

  it('is one tab stop, and the arrow keys move and select within it', () => {
    const onChange = vi.fn()
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        tabs={{
          items: [
            { id: 'team', label: 'Team Members' },
            { id: 'pending', label: 'Pending Invitations' },
          ],
          activeId: 'team',
          onChange,
        }}
      />
    )
    // Roving tabindex: `role='tablist'` promises Tab enters the strip once and
    // the arrows do the rest, so only the active tab may be tabbable.
    const tabButtons = container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(tabButtons?.[0].tabIndex).toBe(0)
    expect(tabButtons?.[1].tabIndex).toBe(-1)

    act(() => {
      tabButtons?.[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      )
    })
    expect(onChange).toHaveBeenCalledWith('pending')
    expect(document.activeElement).toBe(tabButtons?.[1])
  })

  it('applies fixed column widths through colgroup', () => {
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={[{ key: 'role', width: 160, cell: (m: Member) => m.role }]}
        selection={{ selectedIds: [], onSelectionChange: vi.fn() }}
      />
    )
    const cols = container?.querySelectorAll('colgroup col')
    expect(cols).toHaveLength(2)
    expect((cols?.[1] as HTMLElement).style.width).toBe('160px')
  })

  /**
   * A person is never tinted — the product gives people no colour, so a fill
   * here would invent one. Their empty state is the outlined monogram Settings →
   * General's profile picture falls back to. A workspace HAS a colour, so its
   * tile shows it; the radius is what separates a thing from a face.
   */
  describe('identity cell', () => {
    it('falls back to an outlined monogram for a person, with no fill', () => {
      mount(<TableIdentityCell primary='Dara Okafor' secondary='dara@sim.ai' />)
      const monogram = container?.querySelector<HTMLElement>('[class*="rounded-full"]')
      expect(monogram?.textContent).toBe('DO')
      expect(monogram?.className).toContain('border')
      expect(monogram?.style.backgroundColor).toBe('')
    })

    it('ignores a colour passed for a person', () => {
      mount(<TableIdentityCell primary='Ada Lovelace' color='#F472B6' />)
      const monogram = container?.querySelector<HTMLElement>('[class*="rounded-full"]')
      expect(monogram?.style.backgroundColor).toBe('')
    })

    it('shows a circular photo for a person who has one', () => {
      mount(<TableIdentityCell primary='Ada Lovelace' imageSrc='https://example.test/ada.png' />)
      const photo = container?.querySelector('img')
      expect(photo?.getAttribute('src')).toBe('https://example.test/ada.png')
      expect(photo?.className).toContain('rounded-full')
    })

    it("fills a resource's tile with its own colour, never a circle", () => {
      mount(<TableIdentityCell primary='Vega' color='#33C482' subject='resource' />)
      const tile = container?.querySelector<HTMLElement>('[class*="rounded-sm"]')
      expect(tile?.textContent).toBe('V')
      expect(tile?.style.backgroundColor).toBe('rgb(51, 196, 130)')
      expect(container?.querySelector('[class*="rounded-full"]')).toBeNull()
    })

    /**
     * The chip-height avatar is the PERSON treatment only. A workspace keeps the
     * sidebar workspace header's own tile size, which is smaller.
     */
    it('sizes a person at chip height and a resource at the header tile', () => {
      mount(<TableIdentityCell primary='Ada Lovelace' />)
      expect(container?.querySelector('[class*="size-[30px]"]')).not.toBeNull()

      act(() => root?.render(<TableIdentityCell primary='Vega' subject='resource' />))
      expect(container?.querySelector('[class*="size-[16px]"]')).not.toBeNull()
      expect(container?.querySelector('[class*="size-[30px]"]')).toBeNull()
    })
  })

  it('single-select makes the row the control: no checkboxes and no select-all band', () => {
    const onSelect = vi.fn()
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{ mode: 'single', selectedId: 'b', onSelect }}
      />
    )
    expect(container?.querySelectorAll('[role=checkbox]')).toHaveLength(0)
    expect(container?.querySelector('thead')?.textContent ?? '').not.toContain('Select all')
    // No leading control column, so the colgroup matches the caller's columns exactly.
    expect(container?.querySelectorAll('colgroup col')).toHaveLength(columns.length)

    const rowEls = container?.querySelectorAll('tbody tr')
    expect(rowEls?.[1].getAttribute('aria-selected')).toBe('true')
    expect(rowEls?.[0].getAttribute('aria-selected')).toBe('false')

    act(() => (rowEls?.[0] as HTMLElement).click())
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('single-select leaves an unselectable row inert and unfocusable', () => {
    const onSelect = vi.fn()
    mount(
      <Table
        rows={members}
        getRowId={(m) => m.id}
        columns={columns}
        selection={{
          mode: 'single',
          selectedId: null,
          onSelect,
          isRowSelectable: (m: Member) => m.id !== 'a',
        }}
      />
    )
    const rowEls = container?.querySelectorAll('tbody tr')
    expect(rowEls?.[0].getAttribute('tabindex')).toBeNull()
    act(() => (rowEls?.[0] as HTMLElement).click())
    expect(onSelect).not.toHaveBeenCalled()

    act(() => (rowEls?.[1] as HTMLElement).click())
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})
