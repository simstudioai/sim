'use client'

import { useCallback, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { markLessonComplete } from '@/lib/academy/local-progress'
import type { ExerciseBlockState, ExerciseDefinition, ExerciseEdgeState } from '@/lib/academy/types'
import { SandboxCanvasProvider } from '@/app/academy/components/sandbox-canvas-provider'

interface ExerciseViewProps {
  lessonId: string
  exerciseConfig: ExerciseDefinition
  onComplete?: () => void
  videoUrl?: string
  description?: string
}

/**
 * Orchestrates the sandbox canvas for an exercise lesson.
 * Completion is determined client-side by the validation engine and persisted to localStorage.
 */
export function ExerciseView({
  lessonId,
  exerciseConfig,
  onComplete,
  videoUrl,
  description,
}: ExerciseViewProps) {
  const [completed, setCompleted] = useState(false)
  // Reset completion banner when the lesson changes (component is reused across exercise navigations).
  const [prevLessonId, setPrevLessonId] = useState(lessonId)
  if (prevLessonId !== lessonId) {
    setPrevLessonId(lessonId)
    setCompleted(false)
  }

  const handleComplete = useCallback(
    (_blocks: ExerciseBlockState[], _edges: ExerciseEdgeState[]) => {
      setCompleted(true)
      markLessonComplete(lessonId)
      onComplete?.()
    },
    [lessonId, onComplete]
  )

  return (
    <div className='relative flex h-full w-full flex-col overflow-hidden'>
      <SandboxCanvasProvider
        exerciseId={lessonId}
        exerciseConfig={exerciseConfig}
        onComplete={handleComplete}
        videoUrl={videoUrl}
        description={description}
        className='flex-1'
      />

      {completed && (
        <div className='pointer-events-none absolute inset-0 flex items-start justify-center pt-5'>
          <div className='pointer-events-auto flex items-center gap-2 rounded-full border border-[#3A4A3A] bg-[#1F2A1F]/95 px-4 py-2 font-[430] text-[#4CAF50] text-[13px] shadow-lg backdrop-blur-sm'>
            <CheckCircle2 className='h-4 w-4' />
            Exercise complete!
          </div>
        </div>
      )}
    </div>
  )
}
