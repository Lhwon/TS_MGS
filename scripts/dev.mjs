/**
 * 파일명: dev.mjs
 * 설명: 로컬 개발 서버와 데스크톱 프로세스의 시작 및 종료 연결
 * 작성자: 이희원
 * 작성일자: 2026-10-20
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'
const server = await createServer({
  server: { host: '127.0.0.1', port: 3000 },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const env = { ...process.env, TS_MGS_DEV_URL: url }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.'], { stdio: 'inherit', env })
child.on('error', async (error) => {
  console.error(error)
  await server.close()
  process.exit(1)
})
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
console.log(`TS_MGS development: ${url}`)
