'use client'

import { type RefObject, useCallback, useEffect, useState } from 'react'
import { toast } from '@sim/emcn'
import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { SIM_RESOURCE_DRAG_TYPE, SIM_RESOURCES_DRAG_TYPE } from '@/lib/mothership/resource-types'

type FileDragEvent = Pick<
  DragEvent,
  'dataTransfer' | 'preventDefault' | 'stopPropagation' | 'target' | 'type'
>

function resourceDrag(data: DataTransfer) {
  return data.types.includes(SIM_RESOURCE_DRAG_TYPE) || data.types.includes(SIM_RESOURCES_DRAG_TYPE)
}

function acceptFileDrag(event: FileDragEvent): DataTransfer | null {
  if (!event.dataTransfer?.types.includes('Files') || resourceDrag(event.dataTransfer)) return null
  event.preventDefault()
  event.stopPropagation()
  return event.dataTransfer
}

function allowsTextSelection(event: FileDragEvent, data: DataTransfer) {
  const target = event.target
  const textEditor =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && target.selectionStart !== null)
  if (!textEditor || !data.types.includes('text/plain')) return false
  if (event.type !== 'drop') return true
  const html = data.getData('text/html')
  if (html.length > PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS) return false
  // A detached template parses the selection without loading images from the source site.
  const template = document.createElement('template')
  template.innerHTML = html
  return (
    Boolean(template.content.textContent?.trim()) &&
    !template.content.querySelector(
      'a[href], img, picture, svg, audio, video, iframe, object, embed'
    )
  )
}

function guardLinkDrop(event: FileDragEvent, showHelp: boolean) {
  const data = event.dataTransfer
  if (!data || data.types.includes('Files') || resourceDrag(data)) return
  if (
    !data.types.includes('text/uri-list') &&
    (!data.types.includes('text/html') || allowsTextSelection(event, data))
  )
    return
  event.preventDefault()
  event.stopPropagation()
  if (showHelp && event.type === 'drop')
    toast.info('Drop an image file or paste the content into chat.')
}

interface UseFileDropProps {
  processFiles: (files: FileList) => Promise<void>
  target?: RefObject<HTMLElement | null>
  disabled?: boolean
}

/** Handles file drags on the composer or an explicitly expanded chat surface. */
export function useFileDrop({ processFiles, target, disabled }: UseFileDropProps) {
  const [dragDepth, setDragDepth] = useState(0)
  const handleDragEnter = useCallback((event: FileDragEvent) => {
    if (acceptFileDrag(event)) setDragDepth((depth) => depth + 1)
  }, [])
  const handleDragLeave = useCallback((event: FileDragEvent) => {
    if (acceptFileDrag(event)) setDragDepth((depth) => Math.max(0, depth - 1))
  }, [])
  const handleDragOver = useCallback(
    (event: FileDragEvent) => {
      const data = acceptFileDrag(event)
      if (data) data.dropEffect = disabled ? 'none' : 'copy'
      else guardLinkDrop(event, Boolean(target))
    },
    [disabled, target]
  )
  const handleDrop = useCallback(
    (event: FileDragEvent) => {
      const data = acceptFileDrag(event)
      if (!data) return guardLinkDrop(event, Boolean(target))
      setDragDepth(0)
      if (disabled) return
      if (Array.from(data.items).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
        toast.error('Drop files individually instead of folders.')
        return
      }
      void processFiles(data.files)
    },
    [disabled, processFiles, target]
  )

  useEffect(() => {
    const element = target?.current
    if (!element) return
    const controller = new AbortController()
    const options = { capture: true, signal: controller.signal }
    element.addEventListener('dragenter', handleDragEnter, options)
    element.addEventListener('dragleave', handleDragLeave, options)
    element.addEventListener('dragover', handleDragOver, options)
    element.addEventListener('drop', handleDrop, options)
    return () => controller.abort()
  }, [target, handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  return {
    isDragging: !disabled && dragDepth > 0,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  }
}
