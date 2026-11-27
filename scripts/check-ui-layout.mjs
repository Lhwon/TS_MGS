/**
 * 테마와 화면 크기별 리본 및 대화상자의 정렬과 텍스트 잘림 검증
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.MGS_PLAYWRIGHT ??
    'C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-mgs-layout-'))
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
})
const reports = [],
  issues = [],
  errors = []
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' })
  await page.getByTestId('mode-facility').waitFor()
  await page.evaluate(() => document.fonts.ready)
  /** 레이아웃 반영 이후 버튼 안의 실제 텍스트와 아이콘 위치 측정 */
  const audit = async (scope) => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const result = await page.evaluate(() => {
      const clipping = [],
        icons = []
      for (const button of document.querySelectorAll(
        '.design-ribbon-commands .v-btn, .ribbon-group .v-btn',
      )) {
        const box = button.getBoundingClientRect()
        if (!box.width || !box.height || getComputedStyle(button).visibility === 'hidden') continue
        const walker = document.createTreeWalker(
          button.querySelector('.v-btn__content') ?? button,
          NodeFilter.SHOW_TEXT,
        )
        let text
        while ((text = walker.nextNode())) {
          if (!text.textContent.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(text)
          for (const rect of range.getClientRects())
            if (
              rect.top < box.top - 1 ||
              rect.bottom > box.bottom + 1 ||
              rect.left < box.left - 1 ||
              rect.right > box.right + 1
            )
              clipping.push({
                label: button.textContent.trim(),
                width: box.width,
                height: box.height,
                textTop: rect.top - box.top,
                textBottom: rect.bottom - box.top,
              })
        }
      }
      for (const group of document.querySelectorAll('.design-ribbon-commands')) {
        const positions = [...group.querySelectorAll('.v-btn svg')]
          .map((svg) => ({ svg, rect: svg.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width && rect.height)
        if (positions.length < 2) continue
        const delta =
          Math.max(...positions.map(({ rect }) => rect.top)) -
          Math.min(...positions.map(({ rect }) => rect.top))
        if (delta > 1)
          icons.push({
            delta,
            labels: positions.map(({ svg }) => svg.closest('button').textContent.trim()),
          })
      }
      return {
        clipping,
        icons,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      }
    })
    reports.push({ scope, ...result })
    if (result.clipping.length || result.icons.length || result.pageOverflow)
      issues.push({ scope, ...result })
  }
  const tabs = page.getByRole('tablist', { name: '3D 작업 메뉴' })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (value) => {
      const map = (await import('/src/features/map-editor/index.ts')).useEditor()
      if (map.colorMode !== value) map.toggleColorMode()
    }, theme)
    for (const width of [1920, 1366, 1024, 768]) {
      const height = width <= 1024 ? 768 : 900
      await page.setViewportSize({ width, height })
      await page.getByTestId('mode-facility').click()
      for (const name of ['File', 'View', 'Facility', 'Building', 'Lighting', 'Tools', 'Help']) {
        await tabs.getByRole('tab', { name, exact: true }).click()
        if (name === 'Building')
          await page.evaluate(async () =>
            (await import('/src/shared/lib/input/index.ts')).executeAppCommand('scene.workspace', {
              mode: 'building',
            }),
          )
        if (name === 'Facility')
          await page.evaluate(async () =>
            (await import('/src/shared/lib/input/index.ts')).executeAppCommand('scene.workspace', {
              mode: 'equipment',
            }),
          )
        await audit(`${theme}-${width}-3d-${name}`)
        if (width === 1366 && name === 'File')
          await page.screenshot({ path: path.join(output, `${theme}-file.png`) })
      }
      await page.getByTestId('scene-tutorial').click()
      const chooser = page.getByTestId('tutorial-chooser')
      await chooser.waitFor()
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      await page.evaluate(() =>
        Promise.allSettled(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
            .map((animation) => animation.finished),
        ),
      )
      const dialog = await chooser.evaluate((card) => {
        const rect = card.getBoundingClientRect()
        const buttons = [...card.querySelectorAll('[data-testid^="tutorial-start-"]')].map(
          (button) => {
            const title = button.querySelector('strong'),
              description = title.nextElementSibling
            const box = button.getBoundingClientRect(),
              first = title.getBoundingClientRect(),
              second = description.getBoundingClientRect()
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
              titleLeft: first.left,
              descriptionLeft: second.left,
              titleTop: first.top,
              descriptionTop: second.top,
              descriptionBottom: second.bottom,
            }
          },
        )
        const active = document.activeElement
        const titleLeft = card.querySelector('.v-card-title').getBoundingClientRect().left
        const bodyLeft = card.querySelector('.tutorial-chooser-intro').getBoundingClientRect().left
        return {
          buttons,
          titleLeft,
          bodyLeft,
          width: rect.width,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          active: active?.className,
          outline: getComputedStyle(active).outlineStyle,
        }
      })
      reports.push({ scope: `${theme}-${width}-tutorial`, ...dialog })
      if (dialog.left < 0 || dialog.right > width || dialog.top < 0 || dialog.bottom > height)
        issues.push({ scope: `${theme}-${width}-dialog-overflow`, dialog })
      if (
        dialog.buttons.some(
          (button) =>
            Math.abs(button.titleLeft - button.descriptionLeft) > 1 ||
            button.titleLeft - button.left > 24 ||
            button.descriptionBottom > button.bottom - 8,
        )
      )
        issues.push({ scope: `${theme}-${width}-tutorial-alignment`, dialog })
      if (dialog.active.includes('v-card') && dialog.outline !== 'none')
        issues.push({ scope: `${theme}-${width}-dialog-focus`, dialog })
      if (Math.abs(dialog.titleLeft - dialog.bodyLeft) > 1)
        issues.push({ scope: `${theme}-${width}-dialog-heading`, dialog })
      if (width === 1366)
        await page.screenshot({
          path: path.join(output, `${theme}-tutorial.png`),
          animations: 'disabled',
        })
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => ({
        tag: document.activeElement.tagName,
        outline: getComputedStyle(document.activeElement).outlineStyle,
      }))
      if (focus.tag === 'BUTTON' && focus.outline === 'none')
        issues.push({ scope: `${theme}-${width}-keyboard-focus`, focus })
      await chooser.getByRole('button', { name: '닫기', exact: true }).click()
      if (width === 1366) {
        await tabs.getByRole('tab', { name: 'Facility', exact: true }).click()
        await page.evaluate(async () => {
          const studio = (
            await import('/src/features/facility-editor/index.ts')
          ).useFacilityEditor()
          const { executeAppCommand } = await import('/src/shared/lib/input/index.ts')
          await executeAppCommand('scene.workspace', { mode: 'equipment' })
          if (!studio.document.assets.some(({ id }) => id === 'layout-fixture')) {
            studio.setAsset(
              {
                id: 'layout-fixture',
                name: '정렬 검증 설비',
                kind: 'equipment',
                parts: [
                  {
                    id: 'body',
                    name: '본체',
                    shape: 'box',
                    position: { x: 0, y: 0, z: 400 },
                    size: { x: 1000, y: 800, z: 800 },
                    rotation: 0,
                    color: '#638c9f',
                  },
                ],
              },
              { name: '', geometryKey: '' },
            )
            studio.place(0, 0)
          }
          studio.selectedId = studio.document.instances.find(
            ({ assetId }) => assetId === 'layout-fixture',
          ).id
        })
        await page.getByTestId('instance-x').waitFor()
        const fields = await page.locator('.facility-fields:visible').evaluateAll((rows) =>
          rows.map((row) => {
            const inputs = [...row.querySelectorAll('.v-field input')]
            return {
              widths: inputs.map(
                (input) => input.closest('.v-field').getBoundingClientRect().width,
              ),
              heights: inputs.map(
                (input) => input.closest('.v-field').getBoundingClientRect().height,
              ),
              borders: inputs.map((input) => getComputedStyle(input).borderTopWidth),
            }
          }),
        )
        reports.push({ scope: `${theme}-inspector`, fields })
        if (
          fields.some(
            ({ widths, heights, borders }) =>
              (widths.length > 1 && Math.max(...widths) - Math.min(...widths) > 1) ||
              (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 1) ||
              borders.some((border) => border !== '0px'),
          )
        )
          issues.push({ scope: `${theme}-inspector-alignment`, fields })
        await page.screenshot({
          path: path.join(output, `${theme}-inspector.png`),
          animations: 'disabled',
        })
        await page.getByTestId('new-model').click()
        const designer = page.getByTestId('model-designer')
        await designer.waitFor()
        const designerBox = await designer.boundingBox()
        if (
          designerBox.x < 0 ||
          designerBox.y < 0 ||
          designerBox.x + designerBox.width > width + 1 ||
          designerBox.y + designerBox.height > height + 1
        )
          issues.push({ scope: `${theme}-designer-overflow`, designerBox })
        await page.screenshot({
          path: path.join(output, `${theme}-designer.png`),
          animations: 'disabled',
        })
        await page.getByTestId('designer-close').click()
        await page.getByTestId('default-catalog').click()
        await page.getByTestId('model-catalog').waitFor()
        await page.screenshot({
          path: path.join(output, `${theme}-catalog.png`),
          animations: 'disabled',
        })
        await page.getByTestId('glb-import').click()
        const glb = page.getByTestId('glb-import-dialog')
        await glb.waitFor()
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        await page.evaluate(() =>
          Promise.allSettled(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
              .map((animation) => animation.finished),
          ),
        )
        const glbBox = await glb.boundingBox()
        if (
          glbBox.x < 0 ||
          glbBox.y < 0 ||
          glbBox.x + glbBox.width > width + 1 ||
          glbBox.y + glbBox.height > height + 1
        )
          issues.push({ scope: `${theme}-glb-dialog-overflow`, glbBox })
        await page.screenshot({
          path: path.join(output, `${theme}-glb.png`),
          animations: 'disabled',
        })
        await glb.getByRole('button', { name: '취소', exact: true }).click()
        await page.getByTestId('catalog-close').click()
      }
      await page.getByTestId('mode-map').click()
      const mapTabs = page.getByRole('tablist', { name: 'MGS 작업 메뉴' })
      const count = await mapTabs.getByRole('tab').count()
      for (let index = 0; index < count; index++) {
        await mapTabs.getByRole('tab').nth(index).click()
        await audit(`${theme}-${width}-2d-${index}`)
      }
    }
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2))
  console.log(
    JSON.stringify({
      output,
      screens: reports.length,
      issues,
      dialogs: reports.filter((row) => row.buttons).length,
      errors,
    }),
  )
  if (!process.argv.includes('--report-only')) {
    assert.deepEqual(issues, [])
    assert.deepEqual(errors, [])
  }
} finally {
  await browser?.close()
  await server.close()
}
