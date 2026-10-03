### Research Council

An evidence-led research tool that helps you investigate technical questions without forcing a conclusion the sources cannot support.

Research Council retrieves evidence from a Sanity Knowledge Base, runs four research agents in parallel, verifies cited quotes and numbers in deterministic code, and asks a Judge to evaluate the verified evidence.

The verdict can be:

- **SUPPORTED**
- **CONTRADICTED**
- **MIXED**
- **INSUFFICIENT EVIDENCE**

Sometimes the most useful result is knowing that the available evidence cannot settle the question.

### Why I Built It

I started Research Council while researching architectures for an external memory system for people living with dementia.

Should continuous video become captions, persistent entities, episodic events, or knowledge graphs? How should those memories be retrieved over time?

Research papers offered promising results, but they often used different benchmarks, models, subsets, metrics, and experimental conditions. A higher score in one paper did not necessarily mean its architecture was better than another.

I wanted a tool that could help me move from:

> “This paper says this works.”

to:

> “What does the evidence actually allow me to conclude?”

### How It Works

1. **Retrieve evidence:** Code searches the Sanity Knowledge Base and reads relevant entries before the research agents run.
2. **Investigate in parallel:** Four agents examine the same retrieved evidence.
3. **Verify citations:** Deterministic code checks cited quotes and numbers against the source entries.
4. **Issue a verdict:** The Judge reasons over the evidence that survives verification.

| Agent | Role |
| --- | --- |
| Researcher A | Builds the strongest evidence-supported case. |
| Researcher B | Independently investigates the question. |
| Contradiction Hunter | Looks for conflicting evidence, incompatible experimental setups, and invalid comparisons. |
| Evidence Auditor | Examines whether the retrieved material supports the claims. |

A full investigation uses **five model calls**: four research agents in parallel, followed by the Judge.

Citation verification checks whether a quote or number appears in its cited source. It does not, by itself, establish that the research is correct or that two experiments are comparable.

### How Sanity Is Used

Research Council connects to a **Sanity Context MCP endpoint** backed by a research Knowledge Base.

The collection contains 13 papers on AI memory, including video-based memory systems and benchmarks for remembering where objects were last seen.

The Knowledge Base instructions preserve:

- The benchmark, subset, model, and metric behind each result.
- Separate measurements from different papers, without merging or averaging them.
- The distinction between a paper’s own claims and other teams’ evaluations of its method.

### Sanity Context Tools

| Tool | Purpose |
| --- | --- |
| `initial_context` | Fetches the Knowledge Base outline once for the system prompt. |
| `knowledge_base_search` | Searches entries for relevant evidence. |
| `knowledge_base_read` | Reads source entries during retrieval and citation verification. |

Retrieval is controlled by code. All four agents receive the same retrieved evidence.

During verification, the application reads cited entries again from Sanity and checks the claims against the source text.

### Local Development

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set the three server credentials:

```text
SANITY_CONTEXT_MCP_URL=
SANITY_ORGANIZATION_TOKEN=
GOOGLE_GENERATIVE_AI_API_KEY=
```

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

Credentials are read only by the Node server and are never included in browser assets or API responses.

Optional settings and retrieval thresholds are documented in `.env.example`.

### Demos and Live Investigations

Approved, sanitized investigation reports are committed in `demos/`. They contain cited evidence excerpts, without exposing complete retrieved documents or the Knowledge Base identifier.

Private investigation data is stored separately in `runs/`.

By default, a browser session can start **one live investigation**.

Questions below the configured retrieval relevance thresholds stop with **“Outside current research collection”** before any Gemini call and do not consume the session allowance.

Live-job errors returned to the browser are generic. Detailed provider errors remain in server logs.

### Updating Demo Reports

Run this only when replacing demos from locally approved runs:

```bash
npm run build:demos
```

Review the generated diff before releasing the updated reports.

### Command-Line Use

Run a new investigation:

```bash
npm run council
```

Replay a saved local run without model calls:

```bash
npm run replay
```

### Optional Production Deployment

Verify and build the application:

```bash
npm run typecheck
npm test
npm run build
```

Start the production server:

```bash
NODE_ENV=production HOST=0.0.0.0 npm start
```

Deploy:

- `dist/`
- `public/`
- `demos/`
- `package.json`
- Production dependencies

Configure the three server credentials as secrets in your hosting platform.

Do not deploy `.env`, private `runs/`, or raw Knowledge Base documents.

Terminate TLS at the hosting platform or reverse proxy. Production session cookies are marked `Secure`.

Before launch, calibrate the retrieval gate against known in-scope and out-of-scope questions.

The default limiter and job store use in-memory storage. For multiple server instances, replace them with shared durable storage. The limiter is isolated behind `LiveInvestigationLimiter` so an IP- or account-based policy can replace the initial session policy.
