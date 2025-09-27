'use client'

import { useEffect, useState } from 'react'
import { getEnv, isTruthy } from '@/lib/env'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { TrainingFloatingButton } from './training-floating-button'
import { TrainingModal } from './training-modal'

/**
 * Main training controls component that manages the training UI
 * Only renders if COPILOT_TRAINING_ENABLED env var is set AND user has enabled it in settings
 */
export function TrainingControls() {
  const [isEnvEnabled, setIsEnvEnabled] = useState(false)
  const showTrainingControls = useGeneralStore((state) => state.showTrainingControls)
  const { isTraining, showModal, toggleModal } = useCopilotTrainingStore()

  // Check environment variable on mount
  useEffect(() => {
    // Use getEnv to check if training is enabled
    const trainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))
    setIsEnvEnabled(trainingEnabled)
  }, [])

  // Don't render if not enabled by env var OR user settings
  if (!isEnvEnabled || !showTrainingControls) {
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
