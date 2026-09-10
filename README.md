# Spar — an AI co-founder that pushes back

Spar walks a solo builder through all six 0-to-1 stages — Ideation, Validation,
Scoping, Building, Launch, Iteration — as a single persistent chat thread per
idea, producing a real artifact at each stage (one-liner, validation brief,
MVP scope, build plan, launch copy, feedback triage) and carrying context from
one stage into the next.

## What's in this repo

- `landing/spar-landing.html` — standalone demand-test landing page (open
  directly in a browser, no build step).
- `app/spar-app.jsx` — the working chat app, built as a Claude.ai Artifact
  (React component).

## Important: this code was built as a Claude.ai Artifact

`app/spar-app.jsx` relies on two things that only exist inside the Claude.ai
Artifacts runtime:

1. **`window.storage`** — a key/value store Claude.ai provides for free to
   artifacts. Outside that environment this API does not exist, so session
   saving will fail silently.
2. **Direct `fetch` calls to `https://api.anthropic.com/v1/messages`** — inside
   Claude.ai this is proxied and authenticated automatically. On a real
   standalone site, calling the Anthropic API straight from the browser would
   expose your API key, so this needs a small backend (or serverless
   function) that holds the key and forwards the request.

To turn this into a real, deployable website you'd need to:

- Swap `window.storage` for a real backend (e.g. Supabase, a small Node/Express
  API with a database, or even `localStorage` for a single-user local version).
- Add a lightweight proxy endpoint for the Claude API call so the API key
  never reaches the browser.
- Wrap `app/spar-app.jsx` in a standard React build (Vite or Next.js), since
  right now it's a single component meant to be pasted into the Artifacts
  runtime, not a full app scaffold.

Happy to build that version too if/when you want to actually deploy this
beyond Claude.ai.

## Status

Early prototype. Six stages are a thin functional slice — real chat and real
generated artifacts per stage, but no analytics ingestion for Iteration
(feedback is pasted in manually) and no export/share of deliverables yet.
