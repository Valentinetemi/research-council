# Research Council

An evidence-led technical research instrument. The council retrieves relevant knowledge-base entries, runs four specialized research agents in parallel, verifies every cited quote and number in deterministic code, and asks a Judge to issue a supported, contradicted, mixed, or insufficient-evidence verdict.

## Local development

Copy `.env.example` to `.env`, set the three server credentials, then run:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317). Credentials are read only by the Node server and are never included in browser assets or API responses.

The sanitized demo files are committed. Run `npm run build:demos` only when replacing them from locally approved `runs/`, then review the generated diff before release.

## Public behavior

- `demos/` contains approved, sanitized investigation reports. It is separate from private `runs/` data and exposes only cited evidence excerpts, never complete retrieved documents or the knowledge-base identifier.
- A browser session can start one live investigation by default. The limiter is isolated behind `LiveInvestigationLimiter` so a durable IP- or account-based implementation can replace the initial in-memory policy.
- Deterministic retrieval runs before the research agents. Questions below the configured relevance thresholds stop with “Outside current research collection,” without a Gemini call, and do not consume the session allowance.
- Live job errors returned to the browser are generic. Detailed provider errors remain in server logs.

## Production

Build and verify before deploying:

```bash
npm run typecheck
npm test
npm run build
NODE_ENV=production HOST=0.0.0.0 npm start
```

Deploy `dist/`, `public/`, `demos/`, `package.json`, and production dependencies. Do not deploy `.env`, `runs/`, or raw knowledge-base documents. Terminate TLS at the platform or reverse proxy; production session cookies are marked `Secure`.

Configure secrets in the hosting platform:

```text
SANITY_CONTEXT_MCP_URL=
SANITY_ORGANIZATION_TOKEN=
GOOGLE_GENERATIVE_AI_API_KEY=
```

The optional settings and conservative retrieval thresholds are documented in `.env.example`. Calibrate the retrieval gate against known in-scope and out-of-scope questions before launch. For multiple server instances, replace the in-memory limiter and job store with shared durable storage.

## CLI

Run a new command-line investigation with `npm run council`, or replay a local saved run without model calls with `npm run replay`.
