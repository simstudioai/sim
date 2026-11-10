import { expect } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test.use({ hasTouch: true })

for (const theme of ['light', 'dark']) {
  for (const width of [390, 901, 1440]) {
    test(`access toolbar stays stable and protects administrators at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(fixtureUrl(`/integrations/gmail?state=full&theme=${theme}`))
      const main = page.getByRole('main')
      await main
        .getByRole('region', { name: 'Connected credentials', exact: true })
        .getByRole('button', { name: /^Customer operations service account / })
        .click()
      const tabs = main.getByRole('tablist', { name: 'Credential details', exact: true })
      const disconnect = main.getByRole('button', { name: 'Disconnect', exact: true })
      if (width === 1440) {
        const tabBox = await tabs.boundingBox()
        const actionBox = await disconnect.boundingBox()
        expect(
          tabBox &&
            actionBox &&
            Math.abs(tabBox.y + tabBox.height / 2 - actionBox.y - actionBox.height / 2)
        ).toBeLessThanOrEqual(1)
      }
      await main.getByRole('tab', { name: 'Access', exact: true }).click()
      const people = main.getByRole('table', { name: 'People with access', exact: true })
      const lockedSelections = [
        ['Emir Karabeg', 'Access is inherited from workspace administration.'],
        [
          'Nina Patel',
          'This is the last directly assigned admin. Make someone else an admin first.',
        ],
      ] as const
      for (const [name, reason] of lockedSelections) {
        const selection = people.getByRole('checkbox', { name: `Select ${name}`, exact: true })
        await expect(selection).toBeDisabled()
        await selection.hover()
        await expect(page.getByRole('tooltip')).toHaveText(reason)
        await expect(selection).toHaveAccessibleDescription(reason)
        await selection.click({ force: true })
        await expect(selection).not.toBeChecked()
        await page.mouse.move(0, 0)
        await expect(page.getByRole('tooltip')).toHaveCount(0)
        const bounds = await selection.boundingBox()
        if (!bounds) throw new Error('The protected checkbox must remain visible')
        await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await expect(page.getByRole('tooltip')).toHaveText(reason)
        await expect(selection).not.toBeChecked()
        await page.keyboard.press('Escape')
      }
      await people
        .getByRole('checkbox', { name: 'Select all people with access', exact: true })
        .focus()
      const keyboardReasons = new Set<string>()
      for (let stop = 0; stop < 20 && keyboardReasons.size < lockedSelections.length; stop++) {
        await page.keyboard.press('Tab')
        const description = await page.locator(':focus').evaluate((node) =>
          (node.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        )
        for (const [name, reason] of lockedSelections) {
          if (description !== reason) continue
          await expect(page.locator(':focus')).toHaveAccessibleName(`Select ${name}`)
          await expect(page.getByRole('tooltip')).toHaveText(reason)
          await page.keyboard.press('Space')
          await expect(
            people.getByRole('checkbox', { name: `Select ${name}`, exact: true })
          ).not.toBeChecked()
          keyboardReasons.add(reason)
        }
      }
      expect(keyboardReasons.size).toBe(lockedSelections.length)
      await page.keyboard.press('Escape')
      const nina = people.getByRole('row', { name: /Select Nina Patel/ })
      const search = main.getByRole('searchbox', { name: 'Search people', exact: true })
      for (const fontSize of [16, 20, 32]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`
        }, fontSize)
        await test.step(`table fits and stays aligned at ${fontSize}px text`, async () => {
          const geometry = await people.evaluate((table) => {
            const viewport = table.closest('[role="region"]')
            const center = (element: Element) => {
              const box = element.getBoundingClientRect()
              return box.y + box.height / 2
            }
            return {
              overflow: viewport ? viewport.scrollWidth - viewport.clientWidth : null,
              ancestorOverflow: (() => {
                const overflow = []
                for (let parent = table.parentElement; parent; parent = parent.parentElement) {
                  if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(parent).overflowX))
                    overflow.push(parent.scrollWidth - parent.clientWidth)
                }
                return overflow
              })(),
              checkboxOffsets: Array.from(table.querySelectorAll('tr')).flatMap((row) => {
                const checkbox = row.querySelector('[role="checkbox"]')
                const identity = row.querySelector('[data-primary]')
                return checkbox && identity ? [Math.abs(center(checkbox) - center(identity))] : []
              }),
              clippedControls: Array.from(
                table.querySelectorAll(
                  'tbody [aria-label^="Role for"], tbody [aria-label^="Manage access"]'
                )
              ).some((control) => {
                const box = control.getBoundingClientRect()
                const cell = control.closest('td')?.getBoundingClientRect()
                return !cell || box.right > cell.right || box.left < cell.left
              }),
            }
          })
          expect.soft(geometry.overflow).toBe(0)
          for (const overflow of geometry.ancestorOverflow) expect.soft(overflow).toBe(0)
          expect.soft(geometry.clippedControls).toBe(false)
          for (const offset of geometry.checkboxOffsets)
            expect.soft(offset).toBeLessThanOrEqual(0.25)
          const headings = () =>
            people.evaluate((table) =>
              Array.from(table.querySelectorAll('th'))
                .filter((heading) => {
                  const paint = getComputedStyle(heading)
                  return paint.display !== 'none' && paint.clipPath === 'none'
                })
                .map((heading) => {
                  const bounds = heading.getBoundingClientRect()
                  return {
                    label: heading.textContent,
                    x: bounds.x,
                    width: bounds.width,
                  }
                })
            )
          const populated = await headings()
          await search.fill('No matching credential person')
          await expect(people.locator('tbody tr')).toHaveCount(0)
          expect.soft(await headings()).toEqual(populated)
          await search.fill('')
          await expect(nina).toBeVisible()
          expect.soft(await headings()).toEqual(populated)
        })
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = ''
      })
      const alignment = await nina.evaluate((row) => {
        const text = (value: string) =>
          Array.from(row.querySelectorAll('span')).find(
            (node) =>
              node.textContent === value &&
              node.children.length === 0 &&
              node.getBoundingClientRect().height > 0
          )
        const name = text('Nina Patel')
        const email = text('nina@example.test')
        const avatar = row.querySelector('[role="img"]')
        const checkbox = row.querySelector('[role="checkbox"], input[type="checkbox"]')
        const nameCell = name?.closest('td')
        const nameBox = name?.parentElement?.getBoundingClientRect()
        const emailBox = email?.getBoundingClientRect()
        const avatarBox = avatar?.getBoundingClientRect()
        const checkboxBox = checkbox?.getBoundingClientRect()
        const center = (box: DOMRect | undefined) => (box ? box.y + box.height / 2 : null)
        return {
          weight: name ? getComputedStyle(name).fontWeight : null,
          name: center(nameBox),
          email: center(emailBox),
          avatar: center(avatarBox),
          checkbox: center(checkboxBox),
          separateColumns: name?.closest('td') !== email?.closest('td'),
          emailGap:
            emailBox && nameCell ? emailBox.x - nameCell.getBoundingClientRect().right : null,
        }
      })
      expect(alignment.weight).toBe('400')
      expect(alignment.name).not.toBeNull()
      expect(alignment.email).not.toBeNull()
      if (alignment.separateColumns)
        expect(Math.abs(Number(alignment.name) - Number(alignment.email))).toBeLessThanOrEqual(0.25)
      expect(Math.abs(Number(alignment.name) - Number(alignment.avatar))).toBeLessThanOrEqual(1)
      expect(Math.abs(Number(alignment.name) - Number(alignment.checkbox))).toBeLessThanOrEqual(1)
      if (alignment.separateColumns) {
        expect(alignment.emailGap).toBeGreaterThanOrEqual(0)
        expect(alignment.emailGap).toBeLessThanOrEqual(16)
      }
      const changeAccess = main.getByRole('button', { name: 'Change access', exact: true })
      await expect(changeAccess).toBeHidden()
      const sortPeople = main.getByRole('button', { name: 'Sort people', exact: true })
      await expect(sortPeople).toBeVisible()
      const sortX = await sortPeople.evaluate((node) => node.getBoundingClientRect().x)
      const roleFilter = main.getByRole('button', { name: 'Role filter: All roles', exact: true })
      const filterBox = await roleFilter.boundingBox()
      const sortStart = await sortPeople.boundingBox()
      expect(filterBox && sortStart && filterBox.x + filterBox.width <= sortStart.x).toBe(true)
      expect(sortStart && sortStart.x + sortStart.width).toBeLessThanOrEqual(width)
      expect(filterBox?.x).toBeGreaterThanOrEqual(0)
      const filterX = filterBox?.x
      const inheritedRole = people.getByText('Workspace admin', { exact: true })
      const inheritedSize = await inheritedRole.evaluate((node) => {
        const cell = node.closest('td')
        return cell ? cell.scrollWidth - cell.clientWidth : null
      })
      expect(inheritedSize).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      const roleGeometry = await people.evaluate((table) => {
        const heading = Array.from(table.querySelectorAll('th')).find(
          (node) => node.textContent === 'Role'
        )
        const role = table.querySelector('[aria-label^="Role for Nina Patel"]')
        const label =
          role &&
          Array.from(role.querySelectorAll('span')).find(
            (node) => node.textContent === 'Admin' && node.children.length === 0
          )
        const headingRange = document.createRange()
        if (heading) headingRange.selectNodeContents(heading)
        const headingBox = headingRange.getBoundingClientRect()
        const labelBox = label?.getBoundingClientRect()
        const controlBox = role?.getBoundingClientRect()
        return {
          inkOffset: labelBox ? Math.abs(labelBox.x - headingBox.x) : null,
          horizontalInsets: controlBox && labelBox ? controlBox.width - labelBox.width : null,
        }
      })
      expect(roleGeometry.inkOffset).not.toBeNull()
      expect(roleGeometry.inkOffset).toBeLessThanOrEqual(1)
      expect(roleGeometry.horizontalInsets).toBeLessThanOrEqual(18)
      const lockedRole = people.getByRole('button', { name: /^Role for Nina Patel:/ })
      await expect(lockedRole).toBeDisabled()
      // Locked is not dimmed: it paints at the opacity of a role the viewer may change.
      const editableOpacity = await people
        .getByRole('button', { name: /^Role for Alex Chen:/ })
        .evaluate((node) => getComputedStyle(node).opacity)
      await expect(lockedRole).toHaveCSS('opacity', editableOpacity)
      await expect(lockedRole).toHaveCSS('cursor', 'not-allowed')
      const restPaint = await lockedRole.evaluate((node) => {
        const style = getComputedStyle(node)
        return [style.color, style.backgroundColor, style.borderColor]
      })
      await lockedRole.hover()
      expect(
        await lockedRole.evaluate((node) => {
          const style = getComputedStyle(node)
          return [style.color, style.backgroundColor, style.borderColor]
        })
      ).toEqual(restPaint)
      await lockedRole.click({ force: true })
      await expect(page.getByRole('menu')).toHaveCount(0)
      await lockedRole.focus()
      await expect(lockedRole).not.toBeFocused()
      await people
        .getByRole('button', { name: 'Manage access for Emir Karabeg', exact: true })
        .click()
      const leave = page.getByRole('menuitem', { name: 'Leave', exact: true })
      await expect(leave).toBeDisabled()
      await leave.hover()
      await expect(page.getByRole('tooltip')).toContainText(
        'inherited from workspace administration'
      )
      await leave.focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('dialog', { name: 'Leave credential?', exact: true })
      ).toHaveCount(0)
      await page.keyboard.press('Escape')
      const tablePosition = () =>
        people.evaluate((node) => {
          let top = node.getBoundingClientRect().top
          for (let parent = node.parentElement; parent; parent = parent.parentElement)
            top += parent.scrollTop
          return top
        })
      const tableTop = await tablePosition()
      const alexRole = people.getByRole('button', { name: /^Role for Alex Chen:/ })
      await alexRole.click()
      await page.getByRole('menuitemradio', { name: 'Admin', exact: true }).click()
      await expect(
        people.getByRole('checkbox', { name: 'Select Nina Patel', exact: true })
      ).toHaveAccessibleDescription('')
      await people.getByRole('checkbox', { name: 'Select Nina Patel', exact: true }).check()
      await expect(changeAccess).toBeVisible()
      const removeAccess = main.getByRole('button', { name: 'Remove access', exact: true })
      const removeBox = await removeAccess.boundingBox()
      const sortBox = await sortPeople.boundingBox()
      expect(removeBox && sortBox && removeBox.x + removeBox.width <= sortBox.x).toBe(true)
      const selectedFilterBox = await roleFilter.boundingBox()
      expect(selectedFilterBox?.x).toBe(filterX)
      expect(
        removeBox && selectedFilterBox && removeBox.x + removeBox.width <= selectedFilterBox.x
      ).toBe(true)
      await expect
        .poll(() => sortPeople.evaluate((node) => node.getBoundingClientRect().x))
        .toBe(sortX)
      await expect.poll(tablePosition).toBe(tableTop)
      await people.getByRole('checkbox', { name: 'Select Alex Chen', exact: true }).check()
      await expect.poll(tablePosition).toBe(tableTop)
      const selectAll = people.getByRole('checkbox', {
        name: 'Select all people with access',
        exact: true,
      })
      await selectAll.uncheck()
      await expect(changeAccess).toBeHidden()
      await expect(sortPeople).toBeVisible()
      await expect
        .poll(() => sortPeople.evaluate((node) => node.getBoundingClientRect().x))
        .toBe(sortX)
      await expect.poll(tablePosition).toBe(tableTop)
      await selectAll.check()
      await expect.poll(tablePosition).toBe(tableTop)
      await expect(
        people.getByRole('checkbox', { name: 'Select all people with access', exact: true })
      ).toBeChecked()
      await expect(
        people.getByRole('checkbox', { name: 'Select Emir Karabeg', exact: true })
      ).toBeDisabled()
      await expect(main.getByRole('button', { name: 'Remove access', exact: true })).toBeDisabled()
      await removeAccess.hover()
      await expect(page.getByRole('tooltip')).toHaveText(
        'Keep at least one directly assigned admin with access.'
      )
      await changeAccess.focus()
      await page.keyboard.press('Tab')
      await expect(page.locator(':focus')).toHaveAccessibleName('Remove access')
      await expect(page.getByRole('tooltip')).toHaveText(
        'Keep at least one directly assigned admin with access.'
      )
      await page.keyboard.press('Space')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await main.getByRole('button', { name: 'Change access', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Member', exact: true })).toBeDisabled()
      await page.keyboard.press('Escape')
      await search.fill('Alex')
      await expect(main.getByRole('button', { name: 'Remove access', exact: true })).toBeHidden()
      await people.getByRole('checkbox', { name: 'Select Alex Chen', exact: true }).check()
      await main.getByRole('button', { name: 'Change access', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Member', exact: true }).click()
      await expect(alexRole).toContainText('Member')
      await search.fill('')
      await expect(people.getByRole('button', { name: /^Role for Nina Patel:/ })).toContainText(
        'Admin'
      )
    })
  }
}
