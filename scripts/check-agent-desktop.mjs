/**
 * 파일명: check-agent-desktop.mjs
 * 설명: 실제 Electron 격리 브리지에서 반응형 대화 이력과 도구 응답의 연속 전송 검증
 * 작성자: 이희원
 * 작성일자: 2026-11-17
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
const require = createRequire(import.meta.url)
const {
  _electron,
} = require('C:/Users/BEM/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'ts-mgs-ipc-'))
const server = await createServer({
  root,
  cacheDir: path.join(temp, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
})
let app
try {
  await server.listen()
  const main = path.join(temp, 'main.cjs')
  await writeFile(
    main,
    `const {app,BrowserWindow,ipcMain}=require('electron');
let count=0;global.payloads=[];ipcMain.handle('ai:status',()=>({ready:true,defaultModel:'model-a',models:[{name:'model-a',size:1024,parameterSize:'20B',quantization:'Q4'},{name:'model-b',size:2048,parameterSize:'7B',quantization:'Q8'}]}));ipcMain.on('map:dirty',()=>{});ipcMain.on('ai:cancel',()=>{});
ipcMain.handle('ai:propose',(_event,payload)=>{global.payloads.push(payload);count++;return {role:'assistant',content:'desktop reply '+count}});
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(root, 'electron/preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL(${JSON.stringify(server.resolvedUrls.local[0])})});`,
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [main],
    env,
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('open-ai').click()
  await page.getByTestId('ai-models').click()
  await page.locator('[data-model="model-b"]').click()
  assert.equal(
    await page
      .getByTestId('ai-selected-model')
      .textContent()
      .then((text) => text.trim()),
    'model-b',
  )
  assert.equal(await page.getByRole('button', { name: '재연결', exact: true }).count(), 0)
  assert.equal(await page.getByTestId('ai-send').locator('svg path').count(), 1)
  for (let turn = 1; turn <= 3; turn++) {
    await page.getByTestId('ai-prompt').fill('message ' + turn)
    await page.getByTestId('ai-send').click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="ai-cancel"]'))
    assert.equal(
      await page.getByTestId('ai-error').count(),
      0,
      await page.locator('[data-testid="ai-error"]').allTextContents(),
    )
    assert.equal(await page.getByTestId('ai-answer').last().textContent(), 'desktop reply ' + turn)
  }
  const payloads = await app.evaluate(() => global.payloads)
  assert.equal(payloads.length, 3)
  assert.ok(payloads.every((payload) => payload.model === 'model-b'))
  assert.equal(payloads[2].history.filter((item) => item.role === 'user').length, 3)
  assert.equal(payloads[2].history.filter((item) => item.role === 'assistant').length, 2)
  // 중첩된 도구 인수에도 반응형 프록시를 사용하는 동일 통신 경계 검증
  const nested = await page.evaluate(async () => {
    const { reactive } = await import('/node_modules/vue/dist/vue.runtime.esm-bundler.js')
    const { requestProposal } = await import('/src/features/ai-assistant/model/transport.ts')
    const history = reactive([
      { role: 'user', content: 'nested' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'ask_user',
              arguments: {
                question: 'Target',
                fields: [
                  {
                    id: 'port',
                    label: 'Port',
                    type: 'select',
                    options: [{ id: 'P1', label: 'Port 1' }],
                  },
                ],
              },
            },
          },
        ],
      },
      { role: 'tool', tool_name: 'ask_user', content: '{"ok":true}' },
    ])
    return await requestProposal('nested', '{}', history, new AbortController().signal)
  })
  assert.equal(nested.content, 'desktop reply 4')
  console.log('Desktop IPC: consecutive chat and nested reactive tool history OK')
} finally {
  if (app) await app.close()
  await server.close()
  await rm(temp, { recursive: true, force: true })
}
