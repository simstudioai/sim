import { type RefObject, useEffect } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { RESIZE_DEBOUNCE_DELAY } from '../constants'
import { debounce } from '../utils'

/**
 * Custom hook for handling block resize observations
 *
 * @param blockId - The ID of the block
 * @param contentRef - Ref to the content element
 * @param blockHeight - Current block height
 * @param blockWidth - Current block width
 */
export function useBlockResize(
  blockId: string,
  contentRef: RefObject<HTMLDivElement>,
  blockHeight: number,
  blockWidth: number
) {
  const updateNodeInternals = useUpdateNodeInternals()
  const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)

  useEffect(() => {
    if (!contentRef.current) return

    let rafId: number
    const debouncedUpdate = debounce((dimensions: { width: number; height: number }) => {
      if (dimensions.height !== blockHeight || dimensions.width !== blockWidth) {
        updateBlockLayoutMetrics(blockId, dimensions)
        updateNodeInternals(blockId)
      }
    }, RESIZE_DEBOUNCE_DELAY)

    const resizeObserver = new ResizeObserver((entries) => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }

      rafId = requestAnimationFrame(() => {
        for (const entry of entries) {
          const rect = entry.target.getBoundingClientRect()
          const height = entry.borderBoxSize[0]?.blockSize ?? rect.height
          const width = entry.borderBoxSize[0]?.inlineSize ?? rect.width
          debouncedUpdate({ width, height })
        }
      })
    })

    resizeObserver.observe(contentRef.current)

    return () => {
      resizeObserver.disconnect()
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [blockId, blockHeight, blockWidth, contentRef, updateBlockLayoutMetrics, updateNodeInternals])
}
