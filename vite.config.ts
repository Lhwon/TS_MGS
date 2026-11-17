/**
 * 파일명: vite.config.ts
 * 설명: 화면 컴파일과 개발 도구 및 상대 자산 경로를 구성하는 빌드 설정
 * 작성자: 이희원
 * 작성일자: 2026-11-16
 */
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
const { aiStatus, aiPropose, aiAnalyzeDrawing } = createRequire(import.meta.url)(
  './electron/ai-service.cjs',
)
/** 개발 화면에서 같은 출처로 AI 상태와 작업 제안을 요청하는 통신 어댑터 구성 */
const aiDevelopmentApi = (): Plugin => ({
  name: 'mgs-ai-development-api',
  configureServer: (server) => {
    server.middlewares.use('/api/assistant', async (request, response) => {
      const controller = new AbortController()
      response.on('close', () => controller.abort())
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      try {
        if (request.method === 'GET' && request.url === '/status') {
          response.end(JSON.stringify(await aiStatus()))
          return
        }
        if (request.method !== 'POST' || !['/propose', '/drawing'].includes(request.url ?? '')) {
          response.statusCode = 404
          response.end(JSON.stringify({ error: '지원하지 않는 AI 요청입니다.' }))
          return
        }
        let body = ''
        for await (const chunk of request) {
          body += chunk.toString()
          if (body.length > (request.url === '/drawing' ? 2500000 : 400000))
            throw new Error('AI 요청 범위가 너무 큽니다.')
        }
        response.end(
          JSON.stringify(
            await (request.url === '/drawing' ? aiAnalyzeDrawing : aiPropose)(
              JSON.parse(body),
              controller.signal,
            ),
          ),
        )
      } catch (error) {
        response.statusCode = 400
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : 'AI 요청 실패' }),
        )
      }
    })
  },
})
export default defineConfig({
  plugins: [vue(), VueDevTools(), aiDevelopmentApi()],
  base: './',
  resolve: {
    dedupe: ['three'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1' },
  build: { chunkSizeWarningLimit: 700 },
})
