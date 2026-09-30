# SkillDNA Editor Backend

Simple Express proxy to Judge0 CE used by the frontend code runner.

## Setup
1) Copy `.env.example` to `.env` and set `JUDGE0_URL` and optional `JUDGE0_TOKEN`.
2) Install dependencies: `npm install` (or `pnpm install` / `yarn install`).
3) Run locally: `npm run dev` (defaults to `http://localhost:3001`).

The frontend reads `VITE_CODE_RUNNER_URL` and points to this server.

### Collaborative coding
Apply the collaboration tables in `frontend/supabase_schema.sql` in the Supabase SQL editor. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for this backend. The collaboration WebSocket runs at `/collaboration` and requires a persistent Node.js process; it is not available when `VERCEL=1`. The existing telemetry socket remains at `/stream`.

### Supabase health check
If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, hit `GET /health/supabase` to verify connectivity and see the `user_profiles` row count.
