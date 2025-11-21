/**
 * Information needed to create a drag preview for a toolbar item
 */
export interface DragItemInfo {
  name: string
  bgColor: string
  iconElement?: HTMLElement | null
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
    background: #232323;
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

  // Create icon container
  const iconContainer = document.createElement('div')
  iconContainer.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: ${info.bgColor};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  `

  // Clone the actual icon if provided
  if (info.iconElement) {
    const clonedIcon = info.iconElement.cloneNode(true) as HTMLElement
    clonedIcon.style.width = '16px'
    clonedIcon.style.height = '16px'
    clonedIcon.style.color = 'white'
    clonedIcon.style.flexShrink = '0'
    iconContainer.appendChild(clonedIcon)
  }

  // Create text element
  const text = document.createElement('span')
  text.textContent = info.name
  text.style.cssText = `
    color: #FFFFFF;
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
