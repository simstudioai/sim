'use client'

import { useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/workflow-preview'
import { TemplateData } from '../../../../types'

interface TemplatePreviewProps {
  template: TemplateData
}

export function TemplatePreview({ template }: TemplatePreviewProps) {
  const [showSubBlocks, setShowSubBlocks] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleToggleSubBlocks = () => {
    setShowSubBlocks(prev => !prev)
  }

  const handleToggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
  }

  if (!template.workflowState) {
    return (
      <Card className="h-[500px]">
        <CardHeader>
          <CardTitle className="text-lg">Workflow Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-muted-foreground mb-2">Preview not available</div>
            <div className="text-sm text-muted-foreground">
              Workflow state is loading or unavailable
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className={`${isFullscreen ? 'fixed inset-4 z-50' : 'h-[500px]'} transition-all`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Workflow Preview</CardTitle>
            <div className="flex items-center gap-2">

              {/* Toggle Sub-blocks */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleSubBlocks}
                title={showSubBlocks ? 'Hide sub-blocks' : 'Show sub-blocks'}
              >
                {showSubBlocks ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>

              {/* Fullscreen Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleFullscreen}
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0 flex-1">
          <div className={`${isFullscreen ? 'h-[calc(100vh-120px)]' : 'h-[420px]'} w-full`}>
            <WorkflowPreview
              workflowState={template.workflowState}
              showSubBlocks={showSubBlocks}
              height="100%"
              width="100%"
              isPannable={true}
              defaultPosition={{ x: 0, y: 0 }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Overlay for fullscreen */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          onClick={handleToggleFullscreen}
        />
      )}
    </>
  )
} 