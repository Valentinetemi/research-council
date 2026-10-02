import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEMO_DEFINITIONS } from '../src/demo-catalog.js'
import type { Run } from '../src/index.js'
import { buildPublicReport } from '../src/report.js'

const root = process.cwd()
const outputDirectory = join(root, 'demos')

function assertSanitized(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const forbidden of ['"knowledgeBase"', '"text"', '"characters"']) {
    if (serialized.includes(forbidden)) throw new Error(`Public demo contains forbidden field ${forbidden}`)
  }
}

await mkdir(outputDirectory, { recursive: true })

for (const definition of DEMO_DEFINITIONS) {
  const run = JSON.parse(await readFile(join(root, 'runs', definition.sourceRun), 'utf8')) as Run
  const demo = {
    schemaVersion: 1,
    slug: definition.slug,
    title: definition.title,
    description: definition.description,
    report: buildPublicReport(run),
  }
  assertSanitized(demo)
  await writeFile(join(outputDirectory, definition.file), `${JSON.stringify(demo, null, 2)}\n`)
  console.log(`Created demos/${definition.file}`)
}
