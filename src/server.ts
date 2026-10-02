import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename, extname, join, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'
import { liveRun, RUNS_DIR, type Run } from './index.js'
import { buildPublicReport } from './report.js'

const PORT = Number(process.env.PORT ?? 4317)
const HOST = process.env.HOST ?? '127.0.0.1'
const PUBLIC_DIR = join(process.cwd(), 'public')

type StageState = 'pending' | 'running' | 'complete' | 'failed'
type JobStage = { id: string; label: string; state: StageState }
type Job = {
  id: string
  question: string
  state: 'running' | 'complete' | 'failed'
  createdAt: string
  stages: JobStage[]
  logs: string[]
  report?: ReturnType<typeof buildPublicReport>
  error?: string
}

const jobs = new Map<string, Job>()

const stageTemplate = (): JobStage[] => [
  { id: 'retrieval', label: 'Retrieving evidence', state: 'running' },
  { id: 'researcher-a', label: 'Researcher A', state: 'pending' },
  { id: 'researcher-b', label: 'Researcher B', state: 'pending' },
  { id: 'contradiction-hunter', label: 'Contradiction Hunter', state: 'pending' },
  { id: 'evidence-auditor', label: 'Evidence Auditor', state: 'pending' },
  { id: 'verification', label: 'Verifying claims', state: 'pending' },
  { id: 'judge', label: 'Judge reviewing evidence', state: 'pending' },
]

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

const setStage = (job: Job, id: string, state: StageState) => {
  const stage = job.stages.find((item) => item.id === id)
  if (stage) stage.state = state
}

const updateProgress = (job: Job, line: string) => {
  job.logs.push(line)
  job.logs = job.logs.slice(-16)

  if (line.includes('[2/3]')) {
    setStage(job, 'retrieval', 'complete')
    for (const id of ['researcher-a', 'researcher-b', 'contradiction-hunter', 'evidence-auditor']) setStage(job, id, 'running')
  }

  const agents: [string, string][] = [
    ['Researcher A', 'researcher-a'],
    ['Researcher B', 'researcher-b'],
    ['Contradiction Hunter', 'contradiction-hunter'],
    ['Evidence Auditor', 'evidence-auditor'],
  ]
  for (const [name, id] of agents) {
    if (line.includes(`✓ ${name}`)) setStage(job, id, 'complete')
    if (line.includes(`✗ ${name}`)) setStage(job, id, 'failed')
  }

  if (line.includes('[3/3]')) {
    for (const id of ['researcher-a', 'researcher-b', 'contradiction-hunter', 'evidence-auditor']) {
      const stage = job.stages.find((item) => item.id === id)
      if (stage?.state === 'running') stage.state = 'complete'
    }
    setStage(job, 'verification', 'complete')
    setStage(job, 'judge', 'running')
  }
  if (line.includes('✓ Judge:')) setStage(job, 'judge', 'complete')
}

const startJob = (question: string) => {
  const job: Job = {
    id: randomUUID(),
    question,
    state: 'running',
    createdAt: new Date().toISOString(),
    stages: stageTemplate(),
    logs: [],
  }
  jobs.set(job.id, job)

  void liveRun(question, (line) => updateProgress(job, line))
    .then((run) => {
      job.report = buildPublicReport(run)
      job.state = 'complete'
      for (const stage of job.stages) if (stage.state === 'running' || stage.state === 'pending') stage.state = 'complete'
    })
    .catch((error: unknown) => {
      job.state = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      const active = job.stages.find((stage) => stage.state === 'running')
      if (active) active.state = 'failed'
    })

  return job
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 64_000) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

async function runFiles() {
  return (await readdir(RUNS_DIR).catch(() => []))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse()
}

async function readRun(file: string): Promise<Run> {
  if (basename(file) !== file || !file.endsWith('.json')) throw new Error('Invalid run file')
  return JSON.parse(await readFile(join(RUNS_DIR, file), 'utf8')) as Run
}

async function listRuns() {
  const files = (await runFiles()).slice(0, 12)
  return Promise.all(
    files.map(async (file) => {
      const run = await readRun(file)
      return {
        file,
        createdAt: run.createdAt,
        question: run.question,
        verdict: run.judge.verdict,
        sourceCount: run.evidence.length,
        model: run.model,
      }
    }),
  )
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method === 'GET' && url.pathname === '/api/overview') {
    const runs = await listRuns()
    const latest = runs[0] ? await readRun(runs[0].file) : undefined
    return json(res, 200, {
      runs,
      knowledgeBase: latest
        ? {
            sources: latest.evidence.length,
            areas: [...new Set(latest.evidence.map((entry) => entry.path.split('/')[0].replaceAll('_', ' ')))],
            id: latest.knowledgeBase,
          }
        : { sources: 0, areas: [], id: null },
    })
  }

  if (req.method === 'GET' && url.pathname === '/api/report/latest') {
    const files = await runFiles()
    if (!files[0]) return json(res, 404, { error: 'No saved investigations found' })
    return json(res, 200, buildPublicReport(await readRun(files[0])))
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
    const file = decodeURIComponent(url.pathname.slice('/api/runs/'.length))
    try {
      return json(res, 200, buildPublicReport(await readRun(file)))
    } catch (error) {
      return json(res, 404, { error: error instanceof Error ? error.message : 'Run not found' })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/investigations') {
    try {
      const body = await readBody(req)
      const question = typeof body.question === 'string' ? body.question.trim() : ''
      if (question.length < 12) return json(res, 400, { error: 'Enter a specific research question (at least 12 characters).' })
      if (question.length > 2_000) return json(res, 400, { error: 'Keep the research question under 2,000 characters.' })
      const job = startJob(question)
      return json(res, 202, { id: job.id, state: job.state, stages: job.stages })
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' })
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/investigations/')) {
    const id = url.pathname.slice('/api/investigations/'.length)
    const job = jobs.get(id)
    if (!job) return json(res, 404, { error: 'Investigation not found' })
    return json(res, 200, job)
  }

  return json(res, 404, { error: 'Not found' })
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function staticFile(res: ServerResponse, pathname: string) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const resolved = normalize(join(PUBLIC_DIR, requested))
  if (!resolved.startsWith(`${PUBLIC_DIR}/`) && resolved !== join(PUBLIC_DIR, 'index.html')) return false
  try {
    const details = await stat(resolved)
    if (!details.isFile()) return false
    res.writeHead(200, {
      'Content-Type': contentTypes[extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': extname(resolved) === '.html' ? 'no-cache' : 'public, max-age=300',
    })
    createReadStream(resolved).pipe(res)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url)
    if (await staticFile(res, url.pathname)) return
    if (req.method === 'GET' && (await staticFile(res, '/'))) return
    json(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    json(res, 500, { error: 'The server could not complete this request.' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Research Council UI: http://${HOST}:${PORT}`)
})
