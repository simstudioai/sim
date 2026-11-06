import { generateId } from '@sim/utils/id'
import styles from '@/platform/app/(shell)/integrations/_components/slack-slash-commands/slack-slash-commands.module.css'
import { Button, FieldFrame, IconButton, TextField } from '@/platform/design-system/components'

export interface SlackCommandDraft {
  id: string
  command: string
  description: string
  usageHint: string
}

export function slashCommandsError(commands: readonly SlackCommandDraft[]): string | undefined {
  if (commands.some(({ command, description }) => !command.trim() || !description.trim()))
    return 'Every slash command needs a command and description.'
  if (
    commands.some(
      ({ command }) =>
        !command.trim().startsWith('/') || command.trim().length === 1 || /\s/.test(command.trim())
    )
  )
    return 'Slash commands must be one word beginning with /.'
  const names = commands.map(({ command }) => command.trim())
  if (new Set(names).size !== names.length) return 'Each slash command must be unique.'
  return undefined
}

interface SlackSlashCommandsProps {
  commands: readonly SlackCommandDraft[]
  onChange: (commands: SlackCommandDraft[]) => void
}

export function SlackSlashCommands({ commands, onChange }: SlackSlashCommandsProps) {
  function update(id: string, field: 'command' | 'description' | 'usageHint', value: string) {
    onChange(commands.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)))
  }
  return (
    <FieldFrame label='Slash commands' optional error={slashCommandsError(commands)}>
      <div className={styles.heading}>
        <Button
          size='compact'
          icon='I074'
          disabled={commands.length >= 50}
          onClick={() =>
            onChange([
              ...commands,
              { id: generateId(), command: '', description: '', usageHint: '' },
            ])
          }
        >
          Add command
        </Button>
      </div>
      <div className={styles.commands}>
        {commands.map((entry, index) => (
          <section
            className={styles.command}
            key={entry.id}
            aria-label={`Slash command ${index + 1}`}
          >
            <div className={styles.heading}>
              <span data-type='T059'>Command {index + 1}</span>
              <IconButton
                label={`Remove slash command ${index + 1}`}
                icon='I105'
                onClick={() => onChange(commands.filter(({ id }) => id !== entry.id))}
              />
            </div>
            <TextField
              label={`Slash command ${index + 1}`}
              value={entry.command}
              onChange={(value) => update(entry.id, 'command', value)}
              placeholder='/ask-sim'
              maxLength={32}
              required
            />
            <TextField
              label={`Command ${index + 1} description`}
              value={entry.description}
              onChange={(value) => update(entry.id, 'description', value)}
              placeholder='What this command does'
              maxLength={2000}
              required
            />
            <TextField
              label={`Command ${index + 1} usage hint`}
              value={entry.usageHint}
              onChange={(value) => update(entry.id, 'usageHint', value)}
              placeholder='question or task'
              maxLength={1000}
              optional
            />
          </section>
        ))}
      </div>
    </FieldFrame>
  )
}
