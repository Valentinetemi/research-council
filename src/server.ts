import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEMO_DEFINITIONS } from './demo-catalog.js'
import { liveRun, OutsideCollectionError } from './index.js'
import { InMemorySessionLimiter, type LiveInvestigationLimiter } from './rate-limit.js'
import { buildPublicReport } from './report.js'

const PUBLIC_DIR = join(process.cwd(), 'public')
const DEMO_DIR = join(process.cwd(), 'demos')
const SESSION_COOKIE = 'rc_session'
const JOB_TTL_MS = 6 * 60 * 60 * 1_000

type PublicReport = ReturnType<typeof buildPublicReport>
type PublicDemo = {
  schemaVersion: number
  slug: string
  title: string
  description: string
  report: PublicReport
}
type StageState = 'pending' | 'running' | 'complete' | 'failed'
type JobStage = { id: string; label: string; state: StageState }
type Job = {
  id: string
  sessionId: string
  question: string
  state: 'running' | 'complete' | 'outside_collection' | 'failed'
  createdAt: string
  stages: JobStage[]
  report?: PublicReport
  outsideCollection?: { title: string; message: string; areas: string[] }
  error?: string
}

const positiveInteger = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

const PUBLIC_LIVE_LIMIT = positiveInteger('PUBLIC_LIVE_LIMIT', 1)
const MAX_CONCURRENT_INVESTIGATIONS = positiveInteger('MAX_CONCURRENT_INVESTIGATIONS', 3)
const limiter: LiveInvestigationLimiter = new InMemorySessionLimiter(PUBLIC_LIVE_LIMIT)
const jobs = new Map<string, Job>()
let demoCache: PublicDemo[] | undefined

const stageTemplate = (): JobStage[] => [
  { id: 'retrieval', label: 'Retrieving evidence', state: 'running' },
  { id: 'researcher-a', label: 'Researcher A', state: 'pending' },
  { id: 'researcher-b', label: 'Researcher B', state: 'pending' },
  { id: 'contradiction-hunter', label: 'Contradiction Hunter', state: 'pending' },
  { id: 'evidence-auditor', label: 'Evidence Auditor', state: 'pending' },
  { id: 'verification', label: 'Verifying claims', state: 'pending' },
  { id: 'judge', label: 'Judge reviewing evidence', state: 'pending' },
]

const securityHeaders = (res: ServerResponse) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
}

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

const cookieValue = (req: IncomingMessage, name: string) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

const sessionFor = (req: IncomingMessage, res: ServerResponse) => {
  const existing = cookieValue(req, SESSION_COOKIE)
  const id = existing && /^[a-f\d-]{36}$/i.test(existing) ? existing : randomUUID()
  if (id !== existing) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax${secure}`)
  }
  return id
}

const publicJob = ({ sessionId: _sessionId, ...job }: Job) => job

const setStage = (job: Job, id: string, state: StageState) => {
  const stage = job.stages.find((item) => item.id === id)
  if (stage) stage.state = state
}

const updateProgress = (job: Job, line: string) => {
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

const pruneJobs = () => {
  const expiredBefore = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.state !== 'running' && new Date(job.createdAt).getTime() < expiredBefore) jobs.delete(id)
  }
}

const startJob = (question: string, sessionId: string) => {
  pruneJobs()
  const job: Job = {
    id: randomUUID(),
    sessionId,
    question,
    state: 'running',
    createdAt: new Date().toISOString(),
    stages: stageTemplate(),
  }
  jobs.set(job.id, job)

  void liveRun(question, (line) => updateProgress(job, line))
    .then((run) => {
      job.report = buildPublicReport(run)
      job.state = 'complete'
      for (const stage of job.stages) if (stage.state === 'running' || stage.state === 'pending') stage.state = 'complete'
    })
    .catch((error: unknown) => {
      if (error instanceof OutsideCollectionError) {
        limiter.release(sessionId)
        job.state = 'outside_collection'
        setStage(job, 'retrieval', 'complete')
        job.outsideCollection = {
          title: 'Outside current research collection',
          message: error.message,
          areas: error.assessment.areas,
        }
        return
      }
      console.error(`Investigation ${job.id} failed`, error)
      job.state = 'failed'
      job.error = 'The investigation could not be completed. Please try again later.'
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

async function publicDemos() {
  if (demoCache) return demoCache
  demoCache = await Promise.all(
    DEMO_DEFINITIONS.map(async (definition) => {
      const parsed = JSON.parse(await readFile(join(DEMO_DIR, definition.file), 'utf8')) as PublicDemo
      if (parsed.slug !== definition.slug || !parsed.report) throw new Error(`Invalid public demo: ${definition.file}`)
      return parsed
    }),
  )
  return demoCache
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sessionId = sessionFor(req, res)

  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok' })

  if (req.method === 'GET' && url.pathname === '/api/overview') {
    const demos = await publicDemos()
    const paths = [...new Set(demos.flatMap((demo) => demo.report.sources.map((source) => source.path)))]
    return json(res, 200, {
      demos: demos.map(({ report, ...demo }) => ({
        ...demo,
        question: report.question,
        createdAt: report.createdAt,
        verdict: report.verdict,
      })),
      knowledgeBase: {
        sources: paths.length,
        areas: [...new Set(paths.map((path) => path.split('/')[0].replaceAll('_', ' ')))].slice(0, 5),
      },
      liveAllowance: { limit: PUBLIC_LIVE_LIMIT, remaining: limiter.remaining(sessionId) },
    })
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/demos/')) {
    const slug = decodeURIComponent(url.pathname.slice('/api/demos/'.length))
    const demo = (await publicDemos()).find((item) => item.slug === slug)
    if (!demo) return json(res, 404, { error: 'Demo investigation not found' })
    return json(res, 200, demo)
  }

  if (req.method === 'POST' && url.pathname === '/api/investigations') {
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      return json(res, 415, { error: 'This endpoint accepts application/json.' })
    }
    if ([...jobs.values()].filter((job) => job.state === 'running').length >= MAX_CONCURRENT_INVESTIGATIONS) {
      return json(res, 503, { error: 'The council is at capacity. Please try again shortly.' })
    }
    try {
      const body = await readBody(req)
      const question = typeof body.question === 'string' ? body.question.trim() : ''
      if (question.length < 12) return json(res, 400, { error: 'Enter a specific research question (at least 12 characters).' })
      if (question.length > 2_000) return json(res, 400, { error: 'Keep the research question under 2,000 characters.' })
      const decision = limiter.consume(sessionId)
      if (!decision.allowed) {
        return json(res, 429, {
          error: 'This browser session has already used its live investigation. Curated investigations remain available.',
          liveAllowance: { limit: PUBLIC_LIVE_LIMIT, remaining: 0 },
        })
      }
      const job = startJob(question, sessionId)
      return json(res, 202, {
        id: job.id,
        state: job.state,
        stages: job.stages,
        liveAllowance: { limit: PUBLIC_LIVE_LIMIT, remaining: decision.remaining },
      })
    } catch {
      return json(res, 400, { error: 'The request body is not valid JSON.' })
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/investigations/')) {
    pruneJobs()
    const id = url.pathname.slice('/api/investigations/'.length)
    const job = jobs.get(id)
    if (!job) return json(res, 404, { error: 'Investigation not found' })
    return json(res, 200, publicJob(job))
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

async function staticFile(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const resolved = resolve(PUBLIC_DIR, requested)
  if (!resolved.startsWith(`${resolve(PUBLIC_DIR)}${sep}`)) return false
  try {
    const details = await stat(resolved)
    if (!details.isFile()) return false
    res.writeHead(200, {
      'Content-Type': contentTypes[extname(resolved)] ?? 'application/octet-stream',
      'Content-Length': details.size,
      'Cache-Control': extname(resolved) === '.html' ? 'no-cache' : 'public, max-age=300',
    })
    if (req.method === 'HEAD') res.end()
    else createReadStream(resolved).pipe(res)
    return true
  } catch {
    return false
  }
}

export function createResearchServer(): Server {
  const server = createServer(async (req, res) => {
    securityHeaders(res)
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      if (await staticFile(req, res, url.pathname)) return
      json(res, 404, { error: 'Not found' })
    } catch (error) {
      console.error('Request failed', error)
      if (!res.headersSent) json(res, 500, { error: 'The server could not complete this request.' })
      else res.end()
    }
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  return server
}

async function main() {
  await publicDemos()
  const port = positiveInteger('PORT', 4317)
  const host = process.env.HOST ?? '127.0.0.1'
  const server = createResearchServer()
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
  console.log(`Research Council UI: http://${host}:${port}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Research Council could not start.', error)
    process.exitCode = 1
  })
}
