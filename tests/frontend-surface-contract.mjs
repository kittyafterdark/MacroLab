import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(path.join(root, 'src', 'frontend.ts'), 'utf8')
const fixture = JSON.parse(await readFile(path.join(root, 'tests', 'fixtures', 'spindle-surfaces.json'), 'utf8'))

const hotPlateMatch = source.match(/const HOT_PLATE_MOUNT_POINT = '([^']+)'/)
assert(hotPlateMatch, 'Hot Plate mount constant must remain explicit')
assert.equal(hotPlateMatch[1], 'chat_actions', 'Hot Plate belongs on the composer action row')
assert(fixture[hotPlateMatch[1]], 'mock host must expose the Hot Plate mount')

const surfaceBlock = source.match(/const PIPETTE_SURFACES: SurfaceSpec\[\] = \[(.*?)\n\]/s)
assert(surfaceBlock, 'Pipette surface registry must be statically discoverable')
const pipettePoints = [...surfaceBlock[1].matchAll(/point: '([^']+)'/g)].map((match) => match[1])
assert.deepEqual(
  pipettePoints,
  ['world_book_entry_editor', 'loom_block_editor_actions'],
  'Pipette should have one non-overlapping launcher per supported editing surface',
)
assert.equal(new Set(pipettePoints).size, pipettePoints.length, 'Pipette mount points must not duplicate')
for (const point of pipettePoints) assert(fixture[point], `mock host is missing ${point}`)

assert(!surfaceBlock[1].includes('prompt_variables_toolbar'), 'Prompt Variables has no macro-editable text surface, so Pipette must not mount there')
assert(!surfaceBlock[1].includes('preset_editor_toolbar'), 'Loom must not mount both preset + builder launchers in edit mode')
assert(!surfaceBlock[1].includes('world_book_entry_toolbar'), 'World Book launcher must not live below the full entry form')
assert(!surfaceBlock[1].includes('lorebook_workspace'), 'World Book launcher must follow the entry editor itself')
assert(source.includes("iconButton(MACROLAB_LAUNCHER_ICON, label, 'ml-launcher')"), 'closed launchers should share the compact pipette icon')
assert(source.includes("button('+ New macro', 'ml-button-primary')"), 'Hot Plate must expose direct macro creation')
assert(source.includes('resolveSurfaceEditable(surface, launcher)'), 'Pipette must resolve its field from the launcher surface')
assert(source.includes("label: 'Loom block'"), 'Loom Pipette should describe the block editor rather than the preset list')
assert(!source.includes('data-loom-block-editor-toolbar'), 'MacroLab should not depend on a private Loom host marker')
assert(!source.includes('[data-spindle-mount="loom_builder_toolbar"]'), 'MacroLab must not consume the general-purpose Loom builder toolbar')

console.log('frontend surface contract: ok')
