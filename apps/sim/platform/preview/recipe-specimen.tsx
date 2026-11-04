import type { ReactNode } from 'react'
import {
  ComponentRecipe,
  isRecipeKey,
  recipeSlots,
} from '@/platform/design-system/catalog/component-recipe'
import evidence from '@/platform/design-system/catalog/evidence.json'
import { DonutPlot, StackPlot, TrendPlot } from '@/platform/design-system/catalog/plots'
import { Button, SelectField } from '@/platform/design-system/components'
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

function slotValue(name: string, data: PreviewData | null) {
  const placeholder = name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
  if (!data) return placeholder
  if (name in data.specimen) return data.specimen[name]
  const workspace = data.organization.workspaces[0]
  if (name === 'contributor') return data.organization.members[0] ?? ''
  return workspace?.chats[0] ?? workspace?.name ?? ''
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
      if (slot.reference) slots[slot.name] = specimen(slot.reference, data, location)
      else if (slot.kind === 'trend')
        slots[slot.name] = (
          <TrendPlot label='Trend' maximum={18} values={data?.charts.trend ?? []} />
        )
      else if (slot.kind === 'bars')
        slots[slot.name] = (
          <StackPlot label='Runs by day' maximum={18} values={data?.charts.bars ?? []} />
        )
      else if (slot.kind === 'donut')
        slots[slot.name] = (
          <DonutPlot label='Distribution' values={data?.charts.distribution ?? []} />
        )
      else if (slot.kind === 'media')
        slots[slot.name] = data?.samples.media ? (
          <img
            className={styles.media}
            alt={data.samples.media.label}
            src={data.samples.media.src}
          />
        ) : null
      else slots[slot.name] = slotValue(slot.name, data)
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
