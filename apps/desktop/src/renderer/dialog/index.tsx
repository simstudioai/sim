import { ChipModalBody, ChipModalFooter, ChipModalHeader, ChipModalSurface } from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { initializeShellPage, observeShellSize, shellWindow } from '@/renderer/shell'
import type { ShellDialogConfiguration } from '@/shared/shell'
import '@/renderer/shell.css'

interface ShellDialogProps {
  configuration: ShellDialogConfiguration
}

function ShellDialog({ configuration }: ShellDialogProps) {
  const { message, detail, buttons, defaultId, cancelId } = configuration
  const primaryId = buttons.length === 1 ? 0 : buttons.findIndex((_, index) => index !== cancelId)
  const respond = (response: number) => shellWindow?.respond(response)
  const close = () => respond(cancelId)

  return (
    <ChipModalSurface
      ref={(element) => {
        element?.querySelector<HTMLButtonElement>('[data-chip-modal-default-action]')?.focus()
        return observeShellSize(element)
      }}
      role='dialog'
      aria-modal='true'
      aria-labelledby='dialog-title'
      aria-describedby={detail ? 'dialog-message dialog-detail' : 'dialog-message'}
      className='max-h-screen'
    >
      <ChipModalHeader
        onClose={close}
        className='[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]'
      >
        <span id='dialog-title'>{configuration.title}</span>
      </ChipModalHeader>
      <ChipModalBody>
        <p id='dialog-message' className='break-words px-2 text-[var(--text-body)] text-small'>
          {message}
        </p>
        {detail ? (
          <p
            id='dialog-detail'
            className='whitespace-pre-wrap break-words px-2 text-[var(--text-body)] text-small'
          >
            {detail}
          </p>
        ) : null}
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

initializeShellPage()
const container = document.getElementById('root')
if (!container || !shellWindow) throw new Error('Dialog host is unavailable')
void shellWindow.getDialogConfiguration().then((configuration) => {
  document.title = configuration.title
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') shellWindow?.respond(configuration.cancelId)
  })
  createRoot(container).render(<ShellDialog configuration={configuration} />)
})
