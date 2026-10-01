// Browser end-to-end check: 1 tutor + 2 tutees in separate browser contexts.
// Run: npm run build && npm run e2e   (uses the locally installed Google Chrome)
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createApp } from '../server/app.ts'
import { findJdk } from '../server/jdk.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(root, '.tmp-e2e')
const PORT = 3990
const BASE = `http://127.0.0.1:${PORT}`
const CODE = '2468'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'oop-tutoring-e2e-'))
await mkdir(shots, { recursive: true })
const app = createApp({
  port: PORT,
  host: '127.0.0.1',
  dataDir,
  webRoot: path.join(root, 'web', 'dist'),
  tutorCode: CODE,
  jdk: findJdk(),
})
await app.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true })

const step = (msg: string) => console.log(`• ${msg}`)
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(shots, `${name}.png`) })

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message))
  page.on('console', (m) => m.type() === 'error' && console.error('  [console]', m.text()))
  return page
}

async function joinAs(page: Page, name: string) {
  await page.goto(BASE)
  await page.getByPlaceholder('이름').fill(name)
  await page.getByRole('button', { name: '입장' }).click()
  await page.locator('.cm-content').waitFor()
}

/** Replace the whole editor content via keyboard (like a user). */
async function typeAll(page: Page, text: string) {
  const editor = page.locator('.ws-editor .cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  // insertText avoids auto-indent / bracket-closing interfering with the pasted program
  await page.keyboard.insertText(text)
}

try {
  const minsu = await newPage()
  const jieun = await newPage()
  const tutor = await newPage()

  step('tutees join')
  await joinAs(minsu, '민수')
  await joinAs(jieun, '지은')
  assert.match(await minsu.locator('.tab.active').innerText(), /Main\.java/)

  step('tutor logs in and sees both tutees')
  await tutor.goto(`${BASE}/tutor`)
  await tutor.getByPlaceholder('튜터 코드').fill(CODE)
  await tutor.getByRole('button', { name: '로그인' }).click()
  await tutor.locator('.tutee-card').nth(1).waitFor()
  assert.equal(await tutor.locator('.tutee-card').count(), 2)

  step('tutee types → tutor preview updates live')
  await typeAll(
    minsu,
    `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("숫자: ");
        int n = sc.nextInt();
        Animal a = new Dog();
        System.out.println(n * 2 + " " + a.sound());
    }
}
`,
  )
  const card = tutor.locator('.tutee-card', { hasText: '민수' })
  await card.locator('.cm-content', { hasText: 'nextInt' }).waitFor({ timeout: 5000 })
  await shot(tutor, '1-dashboard')

  step('tutee creates class files (multi-file)')
  const createClass = async (page: Page, name: string, body: string) => {
    page.once('dialog', (d) => d.accept(name))
    await page.getByRole('button', { name: '+ 클래스' }).click()
    await page.locator('.tab.active', { hasText: `${name}.java` }).waitFor()
    await typeAll(page, body)
  }
  await createClass(minsu, 'Animal', 'public class Animal {\n    String sound() { return "..."; }\n}\n')
  await createClass(minsu, 'Dog', 'public class Dog extends Animal {\n    String sound() { return "멍멍"; }\n}\n')
  await card.locator('header', { hasText: 'Dog.java' }).waitFor({ timeout: 5000 })

  step('tutor opens 민수 → follows the tutee file, tutee sees "viewing" badge')
  await card.click()
  await tutor.locator('.tab.active', { hasText: 'Dog.java' }).waitFor()
  await minsu.locator('.badge.viewing').waitFor({ timeout: 5000 })

  step('tutor types directly in the tutee code → appears on tutee with highlight')
  await tutor.locator('.ws-editor .cm-line', { hasText: 'return "멍멍"' }).click()
  await tutor.keyboard.press('End')
  await tutor.keyboard.press('Enter')
  await tutor.keyboard.type('// TODO: @Override 붙이기')
  await minsu.locator('.cm-tutor-mark', { hasText: '@Override 붙이기' }).waitFor({ timeout: 5000 })
  // tutor's caret label is visible on the tutee screen
  await minsu.locator('.cm-ySelectionInfo', { hasText: '튜터' }).waitFor({ timeout: 5000 })
  await shot(minsu, '2-tutee-sees-tutor-edit')

  step('tutee undo only reverts the tutee\'s own typing, not the tutor\'s')
  await minsu.waitForTimeout(700) // edits closer than 500ms are merged into one undo step by Y.UndoManager
  await minsu.locator('.ws-editor .cm-line', { hasText: 'public class Dog' }).click()
  await minsu.keyboard.press('End')
  await minsu.keyboard.type(' // 민수')
  await minsu.waitForTimeout(700) // separate undo step from earlier edits
  await minsu.keyboard.press('ControlOrMeta+z')
  await minsu.waitForTimeout(300)
  const after = await minsu.locator('.ws-editor .cm-content').innerText()
  assert.ok(!after.includes('// 민수'), 'tutee edit undone')
  assert.ok(after.includes('@Override 붙이기'), 'tutor edit kept')
  assert.ok(after.includes('return "멍멍"'), 'earlier code kept')

  step('tutor screen follows when the tutee switches files')
  await minsu.locator('.tab', { hasText: 'Animal.java' }).click()
  await tutor.locator('.tab.active', { hasText: 'Animal.java' }).waitFor({ timeout: 5000 })
  await minsu.locator('.tab', { hasText: 'Dog.java' }).click()
  await tutor.locator('.tab.active', { hasText: 'Dog.java' }).waitFor({ timeout: 5000 })

  step('follow can be turned off and back on')
  const follow = tutor.getByLabel('튜티 따라가기')
  await follow.uncheck()
  await minsu.locator('.tab', { hasText: 'Main.java' }).click()
  await tutor.getByRole('button', { name: '튜티 파일로 (Main.java)' }).waitFor({ timeout: 5000 })
  assert.match(await tutor.locator('.tab.active').innerText(), /Dog\.java/)
  await follow.check()
  await tutor.locator('.tab.active', { hasText: 'Main.java' }).waitFor({ timeout: 5000 })

  step('run with Scanner input from the tutee, tutor sees the same console')
  await minsu.locator('.tab', { hasText: 'Main.java' }).click()
  await minsu.getByRole('button', { name: '▶ 실행' }).click()
  await minsu.locator('.console-out', { hasText: '숫자:' }).waitFor({ timeout: 15000 })
  await tutor.locator('.console-out', { hasText: '숫자:' }).waitFor({ timeout: 5000 })
  const input = minsu.locator('.console-in input')
  await input.fill('21')
  await input.press('Enter')
  await minsu.locator('.console-out', { hasText: '42 멍멍' }).waitFor({ timeout: 10000 })
  await tutor.locator('.console-out', { hasText: '42 멍멍' }).waitFor({ timeout: 5000 })
  await shot(tutor, '3-tutor-focus-console')

  step('compile error → markers in editor and error badge on tab')
  await minsu.locator('.tab', { hasText: 'Dog.java' }).click()
  await minsu.locator('.ws-editor .cm-line', { hasText: 'return "멍멍"' }).click()
  await minsu.keyboard.press('End')
  await minsu.keyboard.press('Backspace') // delete the closing brace
  await minsu.keyboard.press('ControlOrMeta+Enter')
  await minsu.locator('.tab-errors').first().waitFor({ timeout: 15000 })
  await minsu.locator('.cm-lintRange-error, .cm-lintPoint-error').first().waitFor({ timeout: 5000 })
  await shot(minsu, '4-compile-error')

  step('Alt+2 switches tutee / Esc returns to dashboard')
  await tutor.keyboard.press('Alt+Digit2')
  await tutor.locator('.btn.chip.active', { hasText: '지은' }).waitFor()
  await tutor.locator('.ws-editor .cm-content').waitFor()
  await minsu.locator('.badge.viewing').waitFor({ state: 'detached', timeout: 5000 })
  // the tutor's caret disappears from the tutee screen once the tutor moves on
  await minsu.locator('.cm-ySelectionInfo', { hasText: '튜터' }).waitFor({ state: 'detached', timeout: 5000 })
  await tutor.keyboard.press('Escape')
  await tutor.locator('.tutee-card').first().waitFor()
  await shot(tutor, '5-dashboard-after')

  step('tutee reload keeps identity and code')
  await minsu.reload()
  await minsu.locator('.tab', { hasText: 'Dog.java' }).waitFor()
  assert.equal(await minsu.locator('.tab').count(), 3)

  console.log('\nE2E OK — screenshots in .tmp-e2e/')
} finally {
  await browser.close()
  await app.close()
  await rm(dataDir, { recursive: true, force: true })
}
process.exit(0)
