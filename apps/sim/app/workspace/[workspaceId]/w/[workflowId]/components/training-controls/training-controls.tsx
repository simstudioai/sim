'use client'

import { useEffect, useState } from 'react'
import { getEnv } from '@/lib/env'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { TrainingFloatingButton } from './training-floating-button'
import { TrainingModal } from './training-modal'

/**
 * Main training controls component that manages the training UI
 * Only renders if COPILOT_TRAINING_ENABLED env var is set
 */
export function TrainingControls() {
  const [isEnabled, setIsEnabled] = useState(false)
  const { isTraining, showModal, toggleModal } = useCopilotTrainingStore()

  // Check environment variable on mount
  useEffect(() => {
    // Use getEnv to check if training is enabled
    const trainingEnabled = getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED') === 'true'
    setIsEnabled(trainingEnabled)
  }, [])

  // Don't render if not enabled
  if (!isEnabled) {
    return null
  }

  return (
    <>
      {/* Floating button to start/stop training */}
      <TrainingFloatingButton isTraining={isTraining} onToggleModal={toggleModal} />

      {/* Modal for entering prompt and viewing dataset */}
      {showModal && <TrainingModal />}
    </>
  )
}
