const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const state = {
  overview: null,
  report: null,
  pollTimer: null,
  glassVisible: false,
  graphNodes: new Map(),
  graphAnimationTimers: [],
  liveRemaining: 1,
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const slug = (value = '') => String(value).toLowerCase().replaceAll(' ', '-')

async function request(path, options) {
  const response = await fetch(path, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || 'The request could not be completed.')
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

function toast(message) {
  const element = $('#toast')
  element.textContent = message
  element.classList.add('show')
  window.setTimeout(() => element.classList.remove('show'), 2200)
}

function formatDate(value, style = 'long') {
  const date = new Date(value)
  const options = style === 'short'
    ? { month: 'short', day: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  return new Intl.DateTimeFormat('en', options).format(date)
}

function verdictLabel(value) {
  return {
    yes: 'Supported',
    no: 'Contradicted',
    mixed: 'Mixed evidence',
    'insufficient evidence': 'Insufficient evidence',
  }[value] || value
}

function showHome({ scrollToArchive = false } = {}) {
  if (state.pollTimer) window.clearTimeout(state.pollTimer)
  clearGraphAnimation()
  concealCouncilGlass()
  $('#home-view').classList.remove('hidden')
  $('#investigation-view').classList.add('hidden')
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.action === (scrollToArchive ? 'archive' : 'home')))
  history.replaceState({}, '', location.pathname)
  window.scrollTo({ top: 0, behavior: 'instant' })
  if (scrollToArchive) window.setTimeout(() => $('#recent-section').scrollIntoView({ behavior: 'smooth' }), 30)
}

function showInvestigation() {
  $('#home-view').classList.add('hidden')
  $('#investigation-view').classList.remove('hidden')
  $$('.nav-link').forEach((link) => link.classList.remove('active'))
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function applyLiveAllowance(liveAllowance = { limit: 1, remaining: 1 }) {
  state.liveRemaining = liveAllowance.remaining
  const exhausted = liveAllowance.remaining < 1
  const button = $('.primary-button')
  button.disabled = exhausted
  $('span', button).textContent = exhausted ? 'Live limit reached' : 'Run council'
  $('#live-allowance').textContent = exhausted
    ? 'live investigation used · curated reports remain available'
    : `${liveAllowance.remaining} live investigation this session`
}

function renderDemos(demos) {
  $('#archive-count').textContent = demos.length
  if (!demos.length) {
    $('#run-list').innerHTML = '<p class="empty-state">Curated investigations are temporarily unavailable.</p>'
    return
  }
  $('#run-list').innerHTML = demos.map((demo) => `
    <button class="run-row" type="button" data-demo-slug="${escapeHtml(demo.slug)}">
      <span class="run-date">CURATED</span>
      <span class="run-question">${escapeHtml(demo.question)}</span>
      <span class="run-verdict ${slug(demo.verdict)}">${escapeHtml(verdictLabel(demo.verdict))}</span>
      <span class="run-arrow" aria-hidden="true">↗</span>
    </button>
  `).join('')
}

async function loadOverview() {
  try {
    const overview = await request('/api/overview')
    state.overview = overview
    $('#source-count').textContent = overview.knowledgeBase.sources
    $('#research-areas').innerHTML = overview.knowledgeBase.areas.length
      ? overview.knowledgeBase.areas.map((area) => `<span>${escapeHtml(area)}</span>`).join('')
      : '<span>No sources yet</span>'
    applyLiveAllowance(overview.liveAllowance)
    renderDemos(overview.demos)
  } catch (error) {
    $('#run-list').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`
    toast(error.message)
  }
}

function renderStages(stages) {
  const complete = stages.filter((stage) => stage.state === 'complete').length
  $('#progress-count').textContent = `${complete} / ${stages.length} complete`
  $('#stages').innerHTML = stages.map((stage, index) => `
    <div class="stage-row ${escapeHtml(stage.state)}">
      <span class="stage-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="stage-name">${escapeHtml(stage.label)}</span>
      <span class="stage-state">${escapeHtml(stage.state)}</span>
    </div>
  `).join('')

  const active = stages.find((stage) => stage.state === 'running')
  if (active) $('#run-note').textContent = `${active.label}…`
  updateCouncilGlass(stages)
}

function activateCouncilGlass(origin) {
  const glass = $('#council-glass')
  glass.classList.remove('hidden', 'phase-parallel', 'phase-converge', 'phase-verdict')
  glass.classList.add('phase-retrieval')
  state.glassVisible = true

  if (!origin || reducedMotion.matches) return
  const target = glass.getBoundingClientRect()
  const deltaX = origin.left + origin.width / 2 - (target.left + target.width / 2)
  const deltaY = origin.top + origin.height / 2 - (target.top + target.height / 2)
  const scaleX = Math.max(0.18, origin.width / target.width)
  const scaleY = Math.max(0.12, origin.height / target.height)

  glass.animate([
    { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`, borderRadius: '2px', opacity: 0.72 },
    { transform: 'translate(-3px, 3px) scale(1.025, .985)', borderRadius: '20px', opacity: 1, offset: 0.76 },
    { transform: 'translate(0, 0) scale(1)', borderRadius: '18px', opacity: 1 },
  ], {
    duration: 820,
    easing: 'cubic-bezier(.16, 1, .3, 1)',
  })

  $$('.council-glass-head, .agent-field, .glass-foot', glass).forEach((element) => {
    element.animate([
      { opacity: 0, transform: 'translateY(5px)' },
      { opacity: 0, transform: 'translateY(5px)', offset: 0.35 },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 720, easing: 'ease-out' })
  })
}

function updateCouncilGlass(stages) {
  if (!state.glassVisible) return
  const glass = $('#council-glass')
  const complete = stages.filter((stage) => stage.state === 'complete').length
  const active = stages.find((stage) => stage.state === 'running')
  $('#glass-progress').textContent = `${complete} / ${stages.length}`
  $('#glass-stage').textContent = active?.label || (complete === stages.length ? 'Verdict ready' : 'Preparing investigation')

  const judge = stages.find((stage) => stage.id === 'judge' || stage.label.startsWith('Judge'))
  const verification = stages.find((stage) => stage.id === 'verification' || stage.label.startsWith('Verifying'))
  const inParallel = stages.some((stage) => ['researcher-a', 'researcher-b', 'contradiction-hunter', 'evidence-auditor'].includes(stage.id) && stage.state !== 'pending')
  const converging = judge?.state === 'running' || judge?.state === 'complete' || verification?.state === 'running' || verification?.state === 'complete'

  glass.classList.toggle('phase-retrieval', !inParallel && !converging)
  glass.classList.toggle('phase-parallel', inParallel && !converging)
  glass.classList.toggle('phase-converge', Boolean(converging))

  $$('[data-glass-agent]', glass).forEach((node) => {
    const stage = stages.find((item) => item.id === node.dataset.glassAgent)
    node.classList.toggle('is-running', stage?.state === 'running')
    node.classList.toggle('is-complete', stage?.state === 'complete')
  })
}

async function concludeCouncilGlass() {
  if (!state.glassVisible) return
  const glass = $('#council-glass')
  glass.classList.remove('phase-retrieval', 'phase-parallel', 'phase-converge')
  glass.classList.add('phase-verdict')
  $('#glass-stage').textContent = 'Verdict ready'
  $('#glass-progress').textContent = '7 / 7'
  if (!reducedMotion.matches) await new Promise((resolve) => window.setTimeout(resolve, 620))
  const animation = reducedMotion.matches ? null : glass.animate([
    { opacity: 1, transform: 'translateY(0) scale(1)' },
    { opacity: 0, transform: 'translateY(8px) scale(.97)' },
  ], { duration: 280, easing: 'ease-in', fill: 'forwards' })
  if (animation) await animation.finished.catch(() => {})
  glass.classList.add('hidden')
  state.glassVisible = false
}

function concealCouncilGlass() {
  $('#council-glass').classList.add('hidden')
  state.glassVisible = false
}

function clearGraphAnimation() {
  state.graphAnimationTimers.forEach((timer) => window.clearTimeout(timer))
  state.graphAnimationTimers = []
}

function beginRunning(question, stages) {
  if ($('#investigation-view').classList.contains('hidden')) showInvestigation()
  $('#report').classList.add('hidden')
  $('#outside-panel').classList.add('hidden')
  $('#running-panel').classList.remove('hidden')
  $('#running-question').textContent = question
  $('#report-id').textContent = 'INVESTIGATION / LIVE'
  renderStages(stages)
}

async function runCouncil(question) {
  if (state.liveRemaining < 1) return toast('This session has already used its live investigation. Try a curated report below.')
  const origin = $('.primary-button').getBoundingClientRect()
  beginRunning(question, [
    { id: 'retrieval', label: 'Retrieving evidence', state: 'running' },
    { id: 'researcher-a', label: 'Researcher A', state: 'pending' },
    { id: 'researcher-b', label: 'Researcher B', state: 'pending' },
    { id: 'contradiction-hunter', label: 'Contradiction Hunter', state: 'pending' },
    { id: 'evidence-auditor', label: 'Evidence Auditor', state: 'pending' },
    { id: 'verification', label: 'Verifying claims', state: 'pending' },
    { id: 'judge', label: 'Judge reviewing evidence', state: 'pending' },
  ])
  activateCouncilGlass(origin)
  try {
    const job = await request('/api/investigations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    applyLiveAllowance(job.liveAllowance)
    history.replaceState({}, '', `?job=${encodeURIComponent(job.id)}`)
    pollJob(job.id)
  } catch (error) {
    if (error.body?.liveAllowance) applyLiveAllowance(error.body.liveAllowance)
    $('#run-note').textContent = error.message
    $('#glass-stage').textContent = 'Unable to start council'
    window.setTimeout(concealCouncilGlass, reducedMotion.matches ? 0 : 900)
    toast(error.message)
  }
}

async function pollJob(id) {
  try {
    const job = await request(`/api/investigations/${encodeURIComponent(id)}`)
    if (!state.glassVisible) activateCouncilGlass()
    beginRunning(job.question, job.stages)
    history.replaceState({}, '', `?job=${encodeURIComponent(id)}`)
    if (job.state === 'complete') {
      await concludeCouncilGlass()
      renderReport(job.report)
      await loadOverview()
      return
    }
    if (job.state === 'outside_collection') {
      concealCouncilGlass()
      renderOutsideCollection(job)
      await loadOverview()
      return
    }
    if (job.state === 'failed') {
      $('#run-note').textContent = job.error || 'The investigation could not be completed.'
      $('#glass-stage').textContent = 'Investigation stopped'
      window.setTimeout(concealCouncilGlass, reducedMotion.matches ? 0 : 900)
      toast('Investigation stopped — review the status for details.')
      return
    }
    state.pollTimer = window.setTimeout(() => pollJob(id), 850)
  } catch (error) {
    $('#run-note').textContent = error.message
    toast(error.message)
  }
}

function resultMetadata(result = {}) {
  const values = [
    ['Benchmark', result.benchmark],
    ['Dataset / subset', result.dataset],
    ['Model', result.model],
    ['Metric', result.metric],
  ]
  return values.map(([label, value]) => `
    <div class="metadata-item">
      <span>${label}</span>
      <strong>${escapeHtml(value || 'Not specified')}</strong>
    </div>
  `).join('')
}

function renderEvidence(report) {
  const claims = report.claims.filter((item) => item.verified)
  if (!claims.length) return '<p class="empty-state">No claims passed deterministic verification in this investigation.</p>'
  return claims.map((item, index) => `
    <article class="evidence-card" id="${escapeHtml(item.id)}">
      <div class="evidence-main">
        <div class="evidence-head">
          <span class="claim-id">Claim ${String(index + 1).padStart(2, '0')} · ${escapeHtml(item.contributedBy.join(' / '))}</span>
          <span class="verification-badge verified">Verified ✓</span>
        </div>
        <p class="claim-text">${escapeHtml(item.claim.claim)}</p>
        <div class="claim-metadata">${resultMetadata(item.claim.result)}</div>
        <button class="evidence-toggle" type="button" data-evidence-claim="${escapeHtml(item.id)}">Inspect evidence</button>
      </div>
    </article>
  `).join('')
}

function renderConflicts(report) {
  if (!report.conflicts.length) {
    return '<p class="empty-state">The contradiction review found no like-for-like result pairs in the retrieved evidence.</p>'
  }
  return report.conflicts.map((group) => {
    const sides = group.claims.slice(0, 2)
    return `
      <article class="conflict-card">
        <div class="conflict-kicker"><span>${escapeHtml(group.id.replace('-', ' '))}</span><span>${escapeHtml(group.benchmark)}</span></div>
        <div class="conflict-sides">
          <div class="conflict-side"><span>${escapeHtml(sides[0].claim.result?.model || 'Approach A')}</span><p>${escapeHtml(sides[0].claim.claim)}</p></div>
          <div class="versus">VS.</div>
          <div class="conflict-side"><span>${escapeHtml(sides[1].claim.result?.model || 'Approach B')}</span><p>${escapeHtml(sides[1].claim.claim)}</p></div>
        </div>
        <div class="conflict-explanation"><strong>Why this is not conclusive</strong><span>${escapeHtml(group.explanation)}</span></div>
      </article>
    `
  }).join('')
}

function renderSources(sources) {
  return sources.map((source, index) => `
    <div class="source-row">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong class="source-path">${escapeHtml(source.path)}</strong>
      <span class="source-score">score ${Number(source.score).toFixed(1)}</span>
      <button type="button" data-source-path="${escapeHtml(source.path)}">Inspect excerpts ↗</button>
    </div>
  `).join('')
}

function renderAgents(agents) {
  return agents.map((agent) => `
    <details class="agent-row">
      <summary>
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        <span class="agent-tally">${agent.ok ? `${agent.verified}/${agent.total} verified` : 'failed'}</span>
      </summary>
      <p class="agent-summary">${escapeHtml(agent.ok ? agent.summary : agent.error)}</p>
    </details>
  `).join('')
}

const evenlySpaced = (count, start, end) => {
  if (count <= 1) return [(start + end) / 2]
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1))
}

const graphPath = (from, to, type) => {
  const fromX = from.x * 10
  const toX = to.x * 10
  if (type === 'conflict') {
    const lift = Math.max(34, Math.abs(toX - fromX) * 0.08)
    const controlY = Math.min(from.y, to.y) - lift
    return `M ${fromX} ${from.y} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${to.y}`
  }
  const midpoint = from.y + (to.y - from.y) * 0.5
  return `M ${fromX} ${from.y} C ${fromX} ${midpoint}, ${toX} ${midpoint}, ${toX} ${to.y}`
}

function renderInvestigationGraph(report) {
  clearGraphAnimation()
  const graphNodes = []
  const nodeById = new Map()
  const addNode = (node) => {
    graphNodes.push(node)
    nodeById.set(node.id, node)
  }

  addNode({ id: 'question', kind: 'question', x: 50, y: 54, kicker: 'Research question', title: report.question, raw: report })

  const sourceXs = evenlySpaced(report.sources.length, 12, 88)
  report.sources.forEach((source, index) => addNode({
    id: source.id,
    kind: 'source',
    x: sourceXs[index],
    y: 148,
    kicker: `Source ${String(index + 1).padStart(2, '0')}`,
    title: source.path,
    count: `relevance ${Number(source.score).toFixed(1)}`,
    raw: source,
  }))

  const agentXs = evenlySpaced(report.agents.length, 19, 81)
  report.agents.forEach((agent, index) => {
    const claims = report.claims.filter((claim) => claim.contributedBy.includes(agent.name))
    addNode({
      id: `agent-${slug(agent.name)}`,
      kind: 'agent',
      x: agentXs[index],
      y: 282,
      kicker: agent.ok ? 'Council agent' : 'Agent failed',
      title: agent.name,
      count: `${claims.length} ${claims.length === 1 ? 'claim' : 'claims'}`,
      raw: agent,
      claims,
    })
  })

  const claimRows = report.claims.length > 6 ? 2 : 1
  const claimsPerRow = Math.ceil(report.claims.length / claimRows)
  for (let row = 0; row < claimRows; row += 1) {
    const rowClaims = report.claims.slice(row * claimsPerRow, (row + 1) * claimsPerRow)
    const rowXs = evenlySpaced(rowClaims.length, row === 0 ? 8 : 13, row === 0 ? 92 : 87)
    rowClaims.forEach((claim, column) => addNode({
      id: claim.id,
      kind: 'claim',
      status: claim.verified ? 'verified' : 'rejected',
      x: rowXs[column],
      y: claimRows === 1 ? 420 : 395 + row * 92,
      kicker: `${claim.verified ? 'Verified' : 'Rejected'} · ${claim.id.replace('-', ' ')}`,
      title: claim.claim.claim,
      count: claim.claim.result?.benchmark || 'Evidence claim',
      raw: claim,
    }))
  }

  const verifiedClaims = report.claims.filter((claim) => claim.verified)
  const rejectedClaims = report.claims.filter((claim) => !claim.verified)
  addNode({
    id: 'verified-evidence',
    kind: 'validation',
    status: 'verified',
    x: 41,
    y: 585,
    kicker: 'Verification result',
    title: 'Verified evidence',
    count: `${verifiedClaims.length} ${verifiedClaims.length === 1 ? 'claim' : 'claims'}`,
    claims: verifiedClaims,
  })
  addNode({
    id: 'rejected-evidence',
    kind: 'validation',
    status: 'rejected',
    x: 59,
    y: 585,
    kicker: 'Verification result',
    title: 'Rejected / unverified',
    count: `${rejectedClaims.length} ${rejectedClaims.length === 1 ? 'claim' : 'claims'}`,
    claims: rejectedClaims,
  })
  addNode({ id: 'judge', kind: 'judge', x: 50, y: 666, kicker: 'Final review', title: 'Judge', raw: report })
  addNode({
    id: 'verdict',
    kind: 'verdict',
    status: slug(report.verdictLabel),
    x: 50,
    y: 744,
    kicker: 'Final verdict',
    title: report.verdictLabel,
    raw: report,
  })

  const edges = []
  const edgeKeys = new Set()
  const addEdge = (from, to, type = '') => {
    const key = `${from}:${to}:${type}`
    if (edgeKeys.has(key) || !nodeById.has(from) || !nodeById.has(to)) return
    edgeKeys.add(key)
    edges.push({ from, to, type })
  }

  report.sources.forEach((source) => addEdge('question', source.id, 'retrieval'))
  report.claims.forEach((claim) => {
    const agentIds = claim.contributedBy
      .filter((name) => name !== 'Judge')
      .map((name) => `agent-${slug(name)}`)
    agentIds.forEach((agentId) => addEdge(agentId, claim.id, claim.verified ? 'verified' : 'rejected'))
    claim.sources.forEach((citation) => {
      const source = report.sources.find((item) => item.path === citation.path)
      if (source) agentIds.forEach((agentId) => addEdge(source.id, agentId, 'evidence'))
    })
    addEdge(claim.id, claim.verified ? 'verified-evidence' : 'rejected-evidence', claim.verified ? 'verified' : 'rejected')
  })

  const auditor = report.agents.find((agent) => agent.name === 'Evidence Auditor')
  if (auditor) report.sources.forEach((source) => addEdge(source.id, 'agent-evidence-auditor', 'evidence'))
  if (verifiedClaims.length) addEdge('verified-evidence', 'judge', 'briefing')
  addEdge('judge', 'verdict', 'verdict')

  report.conflicts.forEach((conflict) => {
    const claims = conflict.claims.filter((claim) => nodeById.has(claim.id))
    for (let index = 1; index < claims.length; index += 1) addEdge(claims[index - 1].id, claims[index].id, 'conflict')
  })

  state.graphNodes = nodeById
  $('#graph-nodes').innerHTML = `
    <span class="graph-layer-label" style="top:18px">Inquiry</span>
    <span class="graph-layer-label" style="top:104px">Retrieved sources</span>
    <span class="graph-layer-label" style="top:226px">Council</span>
    <span class="graph-layer-label" style="top:338px">Claims</span>
    <span class="graph-layer-label" style="top:540px">Verification</span>
    <span class="graph-layer-label" style="top:632px">Judgment</span>
    ${graphNodes.map((node) => `
      <button
        class="graph-node ${escapeHtml(node.kind)} ${escapeHtml(node.status || '')}"
        type="button"
        style="--x:${node.x};--y:${node.y}"
        data-graph-node="${escapeHtml(node.id)}"
        data-graph-stage="${escapeHtml(node.kind)}"
        aria-label="${escapeHtml(`${node.kicker}: ${node.title}`)}"
      >
        <span class="graph-node-kicker">${escapeHtml(node.kicker)}</span>
        <strong class="graph-node-title">${escapeHtml(node.title)}</strong>
        ${node.count ? `<span class="graph-node-count">${escapeHtml(node.count)}</span>` : ''}
      </button>
    `).join('')}
  `
  $('#graph-edges').innerHTML = edges.map((edge) => {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    return `<path class="graph-edge ${escapeHtml(edge.type)}" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" d="${graphPath(from, to, edge.type)}" />`
  }).join('')
  $('#graph-summary').textContent = `${report.sources.length} sources · ${report.claims.length} claims · ${verifiedClaims.length} verified · ${report.conflicts.length} conflict ${report.conflicts.length === 1 ? 'group' : 'groups'}`
  const graphScroll = $('.graph-scroll')
  const centerScrollableGraph = () => {
    if (graphScroll.scrollWidth > graphScroll.clientWidth) {
      graphScroll.scrollLeft = (graphScroll.scrollWidth - graphScroll.clientWidth) / 2
    }
  }
  window.requestAnimationFrame(centerScrollableGraph)
  window.setTimeout(centerScrollableGraph, 120)
  closeGraphInspector()
  playGraphEntrance()
}

function revealGraphConnections() {
  const visible = new Set($$('.graph-node.is-visible').map((node) => node.dataset.graphNode))
  $$('.graph-edge').forEach((edge) => edge.classList.toggle('is-visible', visible.has(edge.dataset.from) && visible.has(edge.dataset.to)))
}

function playGraphEntrance() {
  const frame = $('#graph-frame')
  const nodes = $$('.graph-node', frame)
  const edges = $$('.graph-edge', frame)
  nodes.forEach((node) => node.classList.remove('is-visible'))
  edges.forEach((edge) => edge.classList.remove('is-visible'))
  frame.classList.remove('is-entering')

  if (reducedMotion.matches) {
    nodes.forEach((node) => node.classList.add('is-visible'))
    edges.forEach((edge) => edge.classList.add('is-visible'))
    return
  }

  frame.classList.add('is-entering')
  const sequence = [
    [0, ['question']],
    [180, ['source']],
    [560, ['agent']],
    [980, ['claim']],
    [1460, ['validation']],
    [1840, ['judge']],
    [2160, ['verdict']],
  ]
  sequence.forEach(([delay, kinds]) => {
    state.graphAnimationTimers.push(window.setTimeout(() => {
      kinds.forEach((kind) => $$(`.graph-node[data-graph-stage="${kind}"]`, frame).forEach((node) => node.classList.add('is-visible')))
      revealGraphConnections()
    }, delay))
  })
  state.graphAnimationTimers.push(window.setTimeout(() => frame.classList.remove('is-entering'), 3150))
}

function highlightGraphNode(id) {
  const related = new Set([id])
  $$('.graph-edge').forEach((edge) => {
    if (edge.dataset.from === id) related.add(edge.dataset.to)
    if (edge.dataset.to === id) related.add(edge.dataset.from)
  })
  $$('.graph-node').forEach((node) => {
    node.classList.toggle('is-related', node.dataset.graphNode !== id && related.has(node.dataset.graphNode))
    node.classList.toggle('is-dimmed', !related.has(node.dataset.graphNode))
  })
  $$('.graph-edge').forEach((edge) => {
    const connected = edge.dataset.from === id || edge.dataset.to === id
    edge.classList.toggle('is-related', connected)
    edge.classList.toggle('is-dimmed', !connected)
  })
}

function clearGraphHighlight() {
  $$('.graph-node, .graph-edge').forEach((element) => element.classList.remove('is-related', 'is-dimmed'))
}

const graphClaimList = (claims) => claims.length
  ? `<div class="graph-inspector-list">${claims.map((claim) => `<button type="button" data-evidence-claim="${escapeHtml(claim.id)}">${escapeHtml(claim.claim.claim)}</button>`).join('')}</div>`
  : '<p>No claims were produced in this run.</p>'

function openGraphInspector(node) {
  const inspector = $('#graph-inspector')
  $$('.graph-node').forEach((element) => element.classList.toggle('is-selected', element.dataset.graphNode === node.id))
  $('#graph-inspector-kind').textContent = node.kicker
  $('#graph-inspector-title').textContent = node.title

  if (node.kind === 'agent') {
    $('#graph-inspector-body').innerHTML = `<p>${escapeHtml(node.raw.ok ? node.raw.summary : node.raw.error)}</p>${graphClaimList(node.claims)}`
  } else if (node.kind === 'validation') {
    $('#graph-inspector-body').innerHTML = `<p>${node.status === 'verified' ? 'These claims passed deterministic quote and number verification and were included in the Judge briefing.' : 'These claims did not pass deterministic verification and were withheld from the Judge briefing.'}</p>${graphClaimList(node.claims)}`
  } else if (node.kind === 'judge' || node.kind === 'verdict') {
    $('#graph-inspector-body').innerHTML = `<p>${escapeHtml(node.raw.reasoning)}</p><p>${escapeHtml(`${node.raw.counts.verified} verified claims from ${node.raw.counts.sources} retrieved sources were available for final review.`)}</p>`
  } else {
    $('#graph-inspector-body').innerHTML = `<p>${escapeHtml(node.title)}</p>`
  }
  inspector.classList.remove('hidden')
}

function closeGraphInspector() {
  $('#graph-inspector').classList.add('hidden')
  $$('.graph-node').forEach((node) => node.classList.remove('is-selected'))
}

function handleGraphNode(id) {
  const node = state.graphNodes.get(id)
  if (!node) return
  if (node.kind === 'source') return openSource(node.raw.path)
  if (node.kind === 'claim') return openEvidence(node.raw.id)
  openGraphInspector(node)
}

function renderReport(report) {
  state.report = report
  concealCouncilGlass()
  showInvestigation()
  $('#running-panel').classList.add('hidden')
  $('#outside-panel').classList.add('hidden')
  $('#report').classList.remove('hidden')

  const runCode = new Date(report.createdAt).toISOString().slice(0, 10).replaceAll('-', '')
  $('#report-id').textContent = `INVESTIGATION / ${runCode}`
  $('#report-date').textContent = formatDate(report.createdAt)
  $('#report-question').textContent = report.question
  $('#verdict-text').textContent = report.verdictLabel
  $('#judge-reasoning').textContent = report.reasoning
  $('#verdict-block').className = `verdict-block ${slug(report.verdictLabel)}`
  $('#verdict-metrics').innerHTML = `
    <span><strong>${report.counts.sources}</strong> sources examined</span>
    <span><strong>${report.counts.verified}</strong> verified claims</span>
    <span><strong>${report.agents.filter((agent) => agent.ok).length}/4</strong> agents completed</span>
    <span>model <strong>${escapeHtml(report.model)}</strong></span>
  `
  renderInvestigationGraph(report)
  $('#evidence-list').innerHTML = renderEvidence(report)
  $('#conflict-list').innerHTML = renderConflicts(report)
  $('#question-list').innerHTML = report.openQuestions.length
    ? report.openQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')
    : '<li>No material open questions were recorded by the Judge.</li>'
  $('#source-list').innerHTML = renderSources(report.sources)
  $('#agent-list').innerHTML = renderAgents(report.agents)
}

function renderOutsideCollection(job) {
  state.report = null
  showInvestigation()
  $('#running-panel').classList.add('hidden')
  $('#report').classList.add('hidden')
  $('#outside-panel').classList.remove('hidden')
  $('#report-id').textContent = 'INVESTIGATION / RETRIEVAL ONLY'
  $('#outside-title').textContent = job.outsideCollection?.title || 'Outside current research collection'
  $('#outside-message').textContent = job.outsideCollection?.message || 'The available research collection does not contain enough relevant evidence to investigate this question reliably.'
  const areas = job.outsideCollection?.areas || []
  $('#outside-areas').innerHTML = areas.length
    ? areas.map((area) => `<span>${escapeHtml(area)}</span>`).join('')
    : '<span>No sufficiently related area found</span>'
}

async function loadDemo(slug) {
  showInvestigation()
  $('#outside-panel').classList.add('hidden')
  $('#report').classList.add('hidden')
  $('#running-panel').classList.remove('hidden')
  $('#running-question').textContent = 'Opening curated investigation…'
  try {
    const demo = await request(`/api/demos/${encodeURIComponent(slug)}`)
    history.replaceState({}, '', `?demo=${encodeURIComponent(slug)}`)
    renderReport(demo.report)
  } catch (error) {
    showHome()
    toast(error.message)
  }
}

function openSource(path) {
  const source = state.report?.sources.find((item) => item.path === path)
  if (!source) return toast('Source is not available in this report.')
  if ($('#evidence-dialog').open) $('#evidence-dialog').close()
  $('#dialog-title').textContent = source.path
  $('#dialog-content').textContent = source.passages.length
    ? `Evidence excerpts cited in this investigation\n\n${source.passages.map((passage, index) => `[${index + 1}] ${passage}`).join('\n\n')}`
    : 'This source was retrieved for context, but no verified claim cites an exact passage from it.'
  $('#source-dialog').showModal()
}

function openEvidence(id) {
  const item = state.report?.claims.find((claim) => claim.id === id)
  if (!item) return toast('Evidence is not available in this report.')
  const index = state.report.claims.filter((claim) => claim.verified).findIndex((claim) => claim.id === id) + 1
  $('#evidence-dialog-label').textContent = `Claim ${String(index).padStart(2, '0')} · ${item.verified ? 'Verified' : 'Rejected'}`
  $('#evidence-dialog-title').textContent = item.contributedBy.join(' / ')
  $('#evidence-dialog-claim').textContent = item.claim.claim
  $('#evidence-dialog-meta').innerHTML = resultMetadata(item.claim.result)
  $('#evidence-dialog-proofs').innerHTML = item.sources.map((source) => `
    <div class="proof-row">
      <div class="proof-source">
        <span>Source / ${source.found ? 'quote matched' : 'not matched'}</span>
        <button type="button" data-source-path="${escapeHtml(source.path)}">${escapeHtml(source.path)} ↗</button>
      </div>
      <blockquote class="proof-quote">${escapeHtml(source.quote)}</blockquote>
    </div>
  `).join('')
  $('#evidence-dialog').showModal()
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action
  if (action === 'home') {
    event.preventDefault()
    showHome()
  }
  if (action === 'archive') {
    event.preventDefault()
    showHome({ scrollToArchive: true })
  }

  const suggested = event.target.closest('[data-question]')
  if (suggested) {
    $('#question').value = suggested.dataset.question
    $('#question').focus()
  }

  const demo = event.target.closest('[data-demo-slug]')
  if (demo) loadDemo(demo.dataset.demoSlug)

  const evidence = event.target.closest('[data-evidence-claim]')
  if (evidence) openEvidence(evidence.dataset.evidenceClaim)

  const source = event.target.closest('[data-source-path]')
  if (source) openSource(source.dataset.sourcePath)

  const graphNode = event.target.closest('[data-graph-node]')
  if (graphNode) handleGraphNode(graphNode.dataset.graphNode)
  else if (event.target.closest('#graph-canvas') && !event.target.closest('#graph-inspector')) closeGraphInspector()
})

$('#question-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const question = $('#question').value.trim()
  if (question.length < 12) return toast('Enter a more specific research question.')
  runCouncil(question)
})

$('#question').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') $('#question-form').requestSubmit()
})

$('#close-dialog').addEventListener('click', () => $('#source-dialog').close())
$('#close-evidence-dialog').addEventListener('click', () => $('#evidence-dialog').close())
$('#close-graph-inspector').addEventListener('click', closeGraphInspector)
$('#source-dialog').addEventListener('click', (event) => {
  if (event.target === $('#source-dialog')) $('#source-dialog').close()
})
$('#evidence-dialog').addEventListener('click', (event) => {
  if (event.target === $('#evidence-dialog')) $('#evidence-dialog').close()
})

$('#view-process').addEventListener('click', () => {
  if ($('#investigation-view').classList.contains('hidden')) showInvestigation()
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' })
})

$('#graph-nodes').addEventListener('pointerover', (event) => {
  const node = event.target.closest('[data-graph-node]')
  if (!node || node.contains(event.relatedTarget)) return
  highlightGraphNode(node.dataset.graphNode)
})

$('#graph-nodes').addEventListener('pointerout', (event) => {
  const node = event.target.closest('[data-graph-node]')
  if (!node || node.contains(event.relatedTarget)) return
  clearGraphHighlight()
})

$('#graph-nodes').addEventListener('focusin', (event) => {
  const node = event.target.closest('[data-graph-node]')
  if (node) highlightGraphNode(node.dataset.graphNode)
})

$('#graph-nodes').addEventListener('focusout', clearGraphHighlight)

$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href)
    toast('Report link copied')
  } catch {
    toast('Copy the current address to share this report.')
  }
})

$$('.report-nav a').forEach((link) => link.addEventListener('click', () => {
  $$('.report-nav a').forEach((item) => item.classList.toggle('active', item === link))
}))

async function boot() {
  await loadOverview()
  const params = new URLSearchParams(location.search)
  const demo = params.get('demo')
  const job = params.get('job')
  if (demo) return loadDemo(demo)
  if (job) return pollJob(job)
}

boot()
