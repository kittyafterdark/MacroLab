import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildRoot = path.join(root, '.build')
const distRoot = path.join(root, 'dist')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function read(rel) {
  const file = path.join(buildRoot, rel)
  if (!fs.existsSync(file)) fail(`Missing compiled module: ${rel}. Run TypeScript compilation before bundling.`)
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

function stripImports(source) {
  const lines = source.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimStart()
    if (!trimmed.startsWith('import ')) {
      out.push(lines[i])
      continue
    }

    let statement = lines[i]
    while (!statement.includes(';')) {
      i += 1
      if (i >= lines.length) fail('Encountered an unterminated import declaration while bundling.')
      statement += `\n${lines[i]}`
    }

    if (!/from\s+['"]\.\.?\//.test(statement)) {
      fail(`Refusing to bundle non-relative runtime import:\n${statement}`)
    }
  }
  return out.join('\n')
}

function stripHelperExports(source) {
  return source
    .replace(/\bexport\s+(?=(?:async\s+)?function\b)/g, '')
    .replace(/\bexport\s+(?=(?:const|let|var|class)\b)/g, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
}

function helper(rel) {
  return stripHelperExports(stripImports(read(rel))).trim()
}

function entry(rel) {
  return stripImports(read(rel)).trim()
}

function section(rel, body) {
  return `// ---- bundled from ${rel} ----\n${body}`
}

const frontend = [
  section('core/decision-graph.js', helper('core/decision-graph.js')),
  section('icons.js', helper('icons.js')),
  section('frontend.js', entry('frontend.js')),
].join('\n\n') + '\n'

const backend = [
  section('core/decision-graph.js', helper('core/decision-graph.js')),
  section('core/state.js', helper('core/state.js')),
  section('backend.js', entry('backend.js')),
].join('\n\n') + '\n'

fs.rmSync(distRoot, { recursive: true, force: true })
fs.mkdirSync(distRoot, { recursive: true })
fs.writeFileSync(path.join(distRoot, 'frontend.js'), frontend, 'utf8')
fs.writeFileSync(path.join(distRoot, 'backend.js'), backend, 'utf8')
fs.rmSync(buildRoot, { recursive: true, force: true })

console.log(`✓ Bundled dist/frontend.js (${frontend.length.toLocaleString()} chars)`)
console.log(`✓ Bundled dist/backend.js (${backend.length.toLocaleString()} chars)`)
