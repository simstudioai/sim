/**
 * Information needed to create a drag preview for a toolbar item
 */
export interface DragItemInfo {
  name: string
  bgColor: string
  iconContainer?: HTMLElement | null
}

/**
 * Creates a custom drag preview element that looks like a workflow block.
 * This provides a consistent visual experience when dragging items from the toolbar to the canvas.
 *
 * @param info - Information about the item being dragged
 * @returns HTML element to use as drag preview
 */
export function createDragPreview(info: DragItemInfo): HTMLElement {
  const preview = document.createElement('div')
  preview.style.cssText = `
    width: 250px;
    background: var(--surface-1);
    border-radius: 8px;
    padding: 8px 9px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: system-ui, -apple-system, sans-serif;
    position: fixed;
    top: -500px;
    left: 0;
    pointer-events: none;
    z-index: 9999;
  `

  const iconContainer = info.iconContainer
    ? (info.iconContainer.cloneNode(true) as HTMLElement)
    : document.createElement('div')
  iconContainer.style.width = '24px'
  iconContainer.style.height = '24px'
  iconContainer.style.borderRadius = '6px'
  iconContainer.style.display = 'flex'
  iconContainer.style.alignItems = 'center'
  iconContainer.style.justifyContent = 'center'
  iconContainer.style.flexShrink = '0'
  if (!info.iconContainer) iconContainer.style.background = info.bgColor

  const clonedIcon = iconContainer.querySelector<HTMLElement>('svg, img')
  if (clonedIcon) {
    clonedIcon.style.width = '16px'
    clonedIcon.style.height = '16px'
    clonedIcon.style.flexShrink = '0'
  }

  const text = document.createElement('span')
  text.textContent = info.name
  text.style.cssText = `
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `

  preview.appendChild(iconContainer)
  preview.appendChild(text)

  return preview
}
