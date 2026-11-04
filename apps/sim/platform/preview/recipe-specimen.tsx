import type { ReactNode } from 'react'
import {
  ComponentRecipe,
  isRecipeKey,
  recipeSlots,
} from '@/platform/design-system/catalog/component-recipe'
import evidence from '@/platform/design-system/catalog/evidence.json'
import { Button, MenuItem, SelectField } from '@/platform/design-system/components'
import type { PreviewData, Scenario } from '@/platform/fixtures'
import { ControlSpecimen } from '@/platform/preview/control-specimen'
import styles from '@/platform/preview/specimen.module.css'

const masters = new Map(evidence.map((master) => [master.key, master]))

interface RecipeSpecimenProps {
  theme: 'light' | 'dark'
  destination?: number
  requestedKey?: string
  scenario: Scenario
  data: PreviewData | null
}

function slotValue(family: string, name: string, data: PreviewData | null) {
  if (family === 'IssueGroup') return name === 'title' ? 'Needs review' : 'Created'
  if (family === 'TracePayload' && name === 'format') return 'JSON'
  if (family === 'TracePayload' && name === 'payloadTitle') return 'Input'
  if (!data) return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
  const { organization, specimen } = data
  if (name === 'organizationName') return organization.name
  if (name === 'memberCount')
    return (
      organization.members.length + (organization.members.length === 1 ? ' member' : ' members')
    )
  if (name === 'contributor') return organization.members[0] ?? ''
  if (Object.hasOwn(specimen, name)) return specimen[name]
  const part = /^(label|caption)(\d*)$/.exec(name)
  if (part) {
    const records = part[1] === 'caption' ? data.samples.captions : data.samples.labels
    return records.length ? records[(Number(part[2] || 1) - 1) % records.length] : ''
  }
  return ''
}

interface SpecimenLocation {
  theme: 'light' | 'dark'
  scenario: Scenario
  destination: number
}
function specimen(key: string, data: PreviewData | null, location: SpecimenLocation): ReactNode {
  const master = masters.get(key)
  if (!master) throw new Error(`Missing registered master ${key}`)
  if (isRecipeKey(key)) {
    const slots: Record<string, ReactNode> = {}
    for (const slot of recipeSlots(key)) {
      if (master.family === 'Organization/Summary' && slot.name === 'button') {
        slots[slot.name] = (
          <Button variant='secondary' icon='I074'>
            Invite
          </Button>
        )
      } else if (master.family === 'Menu/Organization/default' && slot.name === 'menuItem') {
        slots[slot.name] = <MenuItem label='Settings' icon='I116' />
      } else if (slot.reference) slots[slot.name] = specimen(slot.reference, data, location)
      else if (slot.kind === 'media')
        slots[slot.name] = data?.samples.media ? (
          <img
            className={styles.media}
            alt={data.samples.media.label}
            src={data.samples.media.src}
          />
        ) : null
      else slots[slot.name] = slotValue(master.family, slot.name, data)
    }
    return <ComponentRecipe recipe={key} slots={slots} />
  }
  return (
    <ControlSpecimen
      master={master}
      data={data}
      location={location}
      renderChild={(child) => specimen(child, data, location)}
    />
  )
}

export function RecipeSpecimen({
  theme,
  requestedKey,
  data,
  scenario,
  destination = 0,
}: RecipeSpecimenProps) {
  const mode = theme === 'light' ? 'L' : 'D'
  const choices = evidence.filter((row) => row.theme === mode)
  const key =
    choices.find((row) => row.key === requestedKey)?.key ?? (mode === 'L' ? 'C1332' : 'C1333')
  return (
    <section className={styles.catalog}>
      <form className={styles.picker} action='/' method='get'>
        <input name='theme' type='hidden' value={theme} />
        <input name='state' type='hidden' value={scenario} />
        <SelectField
          label='Paper master'
          name='recipe'
          defaultValue={key}
          options={choices.map((row) => ({ value: row.key, label: `${row.family} (${row.key})` }))}
        />
        <Button submit variant='secondary'>
          View master
        </Button>
      </form>
      {specimen(key, data, { theme, scenario, destination })}
    </section>
  )
}
