# Research Council

An evidence-led technical research system. The council retrieves relevant knowledge-base entries, runs four specialized research agents in parallel, verifies every cited quote and number in deterministic code, and asks a Judge to issue a supported, contradicted, mixed, or insufficient-evidence verdict.

## Web interface

```bash
npm run web
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317). The home screen can replay every saved investigation without model calls. Starting a new investigation uses the same Sanity Context knowledge base, council, verifier, Judge, and `runs/` archive as the CLI.

The live path expects these values in `.env`:

```text
SANITY_CONTEXT_MCP_URL=
SANITY_ORGANIZATION_TOKEN=
GOOGLE_GENERATIVE_AI_API_KEY=
```

`GEMINI_MODEL` and `PORT` are optional.

## CLI

Run a new investigation with `npm start`, or replay the newest saved run without model calls with `npm run replay`.
