import { Fragment, type ReactNode } from 'react'
import { glyphs, type IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import { ScrollArea } from '@sim/emcn/scroll-area'
import recipes from '#platform/catalog/recipes.json'
import styles from '#platform/catalog/recipes.module.css'

export type RecipeKey = keyof typeof recipes

interface Part {
  rule?: string
  type?: string
  slot?: string
  ink?: boolean
  icon?: string
  parts?: Part[]
}

interface ComponentRecipeProps<Key extends RecipeKey> {
  recipe: Key
  slots: Record<keyof (typeof recipes)[NoInfer<Key>]['slots'], ReactNode>
}

export function isRecipeKey(key: string): key is RecipeKey {
  return Object.hasOwn(recipes, key)
}

export function recipeSlots(key: RecipeKey) {
  return Object.entries(recipes[key].slots).map(([name, value]) => ({
    name,
    kind: value.startsWith('C') ? 'component' : value,
    reference: value.startsWith('C') ? value : undefined,
  }))
}

function isIcon(name: string): name is IconName {
  return Object.hasOwn(glyphs, name)
}

function render(part: Part, slots: Readonly<Record<string, ReactNode>>, path: string): ReactNode {
  if (part.icon && isIcon(part.icon)) {
    return (
      <span
        key={path}
        className={styles[part.rule ?? 'part']}
        data-glyph={part.icon}
        data-icon-ink={part.ink || undefined}
      >
        <Icon name={part.icon} />
      </span>
    )
  }
  const content = part.slot
    ? slots[part.slot]
    : part.parts?.map((child, index) => render(child, slots, `${path}/${index}`))
  if (part.slot && !part.type && !part.rule) return <Fragment key={path}>{content}</Fragment>
  return (
    <div key={path} className={styles[part.rule ?? 'part']} data-type={part.type}>
      {content}
    </div>
  )
}

/** A registered structural master. Interactive children and instance data enter through named slots. */
export function ComponentRecipe<Key extends RecipeKey>({
  recipe,
  slots,
}: ComponentRecipeProps<Key>) {
  for (const name of Object.keys(recipes[recipe].slots)) {
    if (!(name in slots)) throw new Error(`Missing slot ${recipe}.${name}`)
  }
  const body = (
    <div className={styles.root} data-paper-recipe={recipe}>
      {render(recipes[recipe].root, slots, recipe)}
    </div>
  )
  return recipe === 'C1370' || recipe === 'C1371' ? (
    <ScrollArea axis='horizontal' label='Run facts'>
      {body}
    </ScrollArea>
  ) : (
    body
  )
}
