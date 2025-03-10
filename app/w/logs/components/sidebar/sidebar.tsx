'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { WorkflowLog } from '@/app/w/logs/stores/types'
import { formatDate } from '@/app/w/logs/utils/format-date'

interface LogSidebarProps {
  log: WorkflowLog | null
  isOpen: boolean
  onClose: () => void
}

/**
 * Formats JSON content for display, handling multiple JSON objects separated by '--'
 */
const formatJsonContent = (content: string): JSX.Element => {
  // Check if the content has multiple parts separated by '--'
  const parts = content.split(/\s*--\s*/g).filter((part) => part.trim().length > 0)

  if (parts.length > 1) {
    // Handle multiple parts
    return (
      <div className="space-y-4">
        {parts.map((part, index) => (
          <div key={index} className="border-b pb-4 last:border-b-0 last:pb-0">
            {formatSingleJsonContent(part)}
          </div>
        ))}
      </div>
    )
  }

  // Handle single part
  return formatSingleJsonContent(content)
}

/**
 * Formats a single JSON content part
 */
const formatSingleJsonContent = (content: string): JSX.Element => {
  try {
    // Try to parse the content as JSON
    const jsonStart = content.indexOf('{')
    if (jsonStart === -1) return <div className="text-sm break-words">{content}</div>

    const messagePart = content.substring(0, jsonStart).trim()
    const jsonPart = content.substring(jsonStart)

    try {
      const jsonData = JSON.parse(jsonPart)

      return (
        <div>
          {messagePart && <div className="mb-2 font-medium text-sm break-words">{messagePart}</div>}
          <div className="bg-secondary/50 p-3 rounded-md">
            <pre className="text-xs whitespace-pre-wrap break-all max-w-full overflow-hidden">
              <code>{JSON.stringify(jsonData, null, 2)}</code>
            </pre>
          </div>
        </div>
      )
    } catch (e) {
      // If JSON parsing fails, try to find and format any valid JSON objects in the content
      const jsonRegex = /{[^{}]*({[^{}]*})*[^{}]*}/g
      const jsonMatches = content.match(jsonRegex)

      if (jsonMatches && jsonMatches.length > 0) {
        return (
          <div>
            {messagePart && (
              <div className="mb-2 font-medium text-sm break-words">{messagePart}</div>
            )}
            {jsonMatches.map((jsonStr, idx) => {
              try {
                const parsedJson = JSON.parse(jsonStr)
                return (
                  <div key={idx} className="bg-secondary/50 p-3 rounded-md mt-2">
                    <pre className="text-xs whitespace-pre-wrap break-all max-w-full overflow-hidden">
                      <code>{JSON.stringify(parsedJson, null, 2)}</code>
                    </pre>
                  </div>
                )
              } catch {
                return (
                  <div key={idx} className="mt-2 text-sm break-words">
                    {jsonStr}
                  </div>
                )
              }
            })}
          </div>
        )
      }
    }
  } catch (e) {
    // If all parsing fails, return the original content
  }

  return <div className="text-sm break-words">{content}</div>
}

export function Sidebar({ log, isOpen, onClose }: LogSidebarProps) {
  const [width, setWidth] = useState(400) // Default width from the original styles
  const [isDragging, setIsDragging] = useState(false)

  const formattedContent = useMemo(() => {
    if (!log) return null
    return formatJsonContent(log.message)
  }, [log])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newWidth = window.innerWidth - e.clientX
        // Maintain minimum and maximum widths
        setWidth(Math.max(400, Math.min(newWidth, window.innerWidth * 0.8)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Handle escape key to close the sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return (
    <div
      className={`fixed inset-y-0 right-0 bg-background border-l shadow-lg transform transition-transform duration-200 ease-in-out z-50 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ top: '64px', width: `${width}px` }}
    >
      <div
        className="absolute left-[-4px] top-0 bottom-0 w-4 cursor-ew-resize hover:bg-accent/50 z-50"
        onMouseDown={handleMouseDown}
      />
      {log && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="text-base font-medium">Log Details</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-0"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <ScrollArea className="h-[calc(100vh-64px-49px)]">
            {' '}
            {/* Adjust for header height */}
            <div className="p-4 space-y-4">
              {/* Timestamp */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Timestamp</h3>
                <p className="text-sm">{formatDate(log.createdAt).full}</p>
              </div>

              {/* Workflow */}
              {log.workflow && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Workflow</h3>
                  <div
                    className="inline-flex items-center px-2 py-1 text-xs rounded-md"
                    style={{
                      backgroundColor: `${log.workflow.color}20`,
                      color: log.workflow.color,
                    }}
                  >
                    {log.workflow.name}
                  </div>
                </div>
              )}

              {/* Execution ID */}
              {log.executionId && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Execution ID</h3>
                  <p className="text-sm font-mono break-all">{log.executionId}</p>
                </div>
              )}

              {/* Level */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Level</h3>
                <p className="text-sm capitalize">{log.level}</p>
              </div>

              {/* Trigger */}
              {log.trigger && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Trigger</h3>
                  <p className="text-sm capitalize">{log.trigger}</p>
                </div>
              )}

              {/* Duration */}
              {log.duration && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-1">Duration</h3>
                  <p className="text-sm">{log.duration}</p>
                </div>
              )}

              {/* Message Content */}
              <div className="pb-2">
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Message</h3>
                <div>{formattedContent}</div>
              </div>
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
