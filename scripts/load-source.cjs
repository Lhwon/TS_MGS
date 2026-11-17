const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()

/** 프로젝트의 순수 타입스크립트 모듈을 실행 도구에서 재사용하는 소스 로딩 */
const loadSource = (filename) => {
  const target = path.resolve(root, filename)
  if (cache.has(target)) return cache.get(target)
  const exports = {}
  cache.set(target, exports)
  const code = ts.transpileModule(fs.readFileSync(target, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', code)(exports, (specifier) => {
    if (specifier === '@bem/map3d') return loadSource('packages/map3d/index.ts')
    const resolved = specifier.startsWith('@/')
      ? path.resolve(root, 'src', specifier.slice(2))
      : path.resolve(path.dirname(target), specifier)
    return loadSource(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  })
  return exports
}

module.exports = { loadSource }
