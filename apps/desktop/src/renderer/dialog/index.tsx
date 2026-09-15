import {
  ChipModalBody,
  ChipModalDescription,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalSurface,
} from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { initializeShellPage, mountShellModal, shellWindow } from '@/renderer/shell'
import type { ShellDialogConfiguration } from '@/shared/shell'
import '@/renderer/shell.css'

interface ShellDialogProps {
  configuration: ShellDialogConfiguration
}

function ShellDialog({ configuration }: ShellDialogProps) {
  const { text, buttons, defaultId, cancelId } = configuration
  const primaryId = buttons.length === 1 ? 0 : buttons.findIndex((_, index) => index !== cancelId)
  const respond = (response: number) => shellWindow?.respond(response)
  const close = () => respond(cancelId)

  return (
    <ChipModalSurface
      ref={(element) => mountShellModal(element, close)}
      role='dialog'
      aria-modal='true'
      aria-labelledby='dialog-title'
      aria-describedby={text ? 'dialog-message' : undefined}
      className='max-h-screen'
    >
      <ChipModalHeader
        onClose={close}
        className='[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]'
      >
        <span id='dialog-title'>{configuration.title}</span>
      </ChipModalHeader>
      <ChipModalBody>
        {text ? <ChipModalDescription id='dialog-message'>{text}</ChipModalDescription> : null}
      </ChipModalBody>
      <ChipModalFooter
        defaultAction={defaultId === primaryId ? 'primary' : 'dismiss'}
        {...(buttons.length > 1
          ? { onCancel: close, cancelLabel: buttons[cancelId] }
          : { hideCancel: true })}
        primaryAction={{
          label: buttons[primaryId],
          variant: configuration.primaryVariant,
          onClick: () => respond(primaryId),
        }}
        secondaryActions={buttons.flatMap((label, index) =>
          index !== primaryId && index !== cancelId
            ? [{ label, onClick: () => respond(index) }]
            : []
        )}
      />
    </ChipModalSurface>
  )
}

const container = document.getElementById('root')
if (!container || !shellWindow) throw new Error('Dialog host is unavailable')
void Promise.all([initializeShellPage(), shellWindow.getDialogConfiguration()]).then(
  ([, configuration]) => {
    document.title = configuration.title
    createRoot(container).render(<ShellDialog configuration={configuration} />)
  }
)
