import { expect, test } from '@playwright/test'

test('typing preserves the resting field and wrapper appearance in both themes', async ({
  page,
}) => {
  for (const [theme, input, textarea, search] of [
    ['light', 'C0343', 'C0352', 'C1084'],
    ['dark', 'C0341', 'C0350', 'C1083'],
  ]) {
    for (const [key, name] of [
      [input, 'ChipInput'],
      [textarea, 'ChipTextarea'],
      [search, 'Search'],
    ]) {
      await page.goto(`http://127.0.0.1:3181/?recipe=${key}&theme=${theme}&state=full`)
      const field =
        key === search
          ? page.getByRole('searchbox')
          : page.getByRole('textbox', { name, exact: true })
      const appearance = () =>
        field.evaluate((element) =>
          [element, element.parentElement].map((node) => {
            if (!node) throw new Error('Missing field wrapper')
            const css = getComputedStyle(node)
            return [css.outlineStyle, css.borderColor, css.backgroundColor, css.boxShadow]
          })
        )
      const resting = await appearance()
      await field.focus()
      await expect(field).toBeFocused()
      await field.fill('Edited')
      await expect(field).toHaveValue('Edited')
      expect(await appearance(), key).toEqual(resting)
    }
  }
})
