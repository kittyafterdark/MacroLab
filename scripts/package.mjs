import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const output = path.join(root, `MacroLab-${pkg.version}.zip`)

const excludedDirs = new Set(['.git', 'node_modules'])
const excludedFiles = new Set([path.basename(output)])

function walk(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) out.push(...walk(abs, rel))
    } else if (!excludedFiles.has(entry.name) && !entry.name.endsWith('.zip')) {
      out.push({ rel, abs })
    }
  }
  return out
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c >>> 0
}
function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

function u16(value) {
  const b = Buffer.allocUnsafe(2); b.writeUInt16LE(value & 0xffff); return b
}
function u32(value) {
  const b = Buffer.allocUnsafe(4); b.writeUInt32LE(value >>> 0); return b
}

const files = walk(root)
const localChunks = []
const centralChunks = []
let offset = 0

for (const file of files) {
  const data = fs.readFileSync(file.abs)
  const name = Buffer.from(file.rel.replaceAll('\\', '/'), 'utf8')
  const stat = fs.statSync(file.abs)
  const { dosTime, dosDate } = dosDateTime(stat.mtime)
  const crc = crc32(data)

  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
    u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
  ])
  localChunks.push(local, data)

  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
    u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(offset), name,
  ])
  centralChunks.push(central)
  offset += local.length + data.length
}

const central = Buffer.concat(centralChunks)
const end = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(central.length), u32(offset), u16(0),
])
fs.writeFileSync(output, Buffer.concat([...localChunks, central, end]))
console.log(`✓ Wrote ${path.basename(output)} with ${files.length} files (${fs.statSync(output).size.toLocaleString()} bytes).`)
