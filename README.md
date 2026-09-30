<div align="center">

# 🧠 MindCode

**AI-powered coding assessment with cognitive profiling, behavioral telemetry, and recruiter-grade analytics.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

</div>

---

## Overview

MindCode goes beyond traditional coding tests. It captures **how** a candidate thinks — not just whether their code compiles. By combining real-time keystroke telemetry, webcam-based proctoring, Judge0 code execution, and an AI-driven cognitive report pipeline, MindCode produces deep, recruiter-ready profiles from a single assessment session.

> **For candidates** — a smooth, Monaco-powered coding experience with live code execution and detailed post-assessment feedback.

---

## ✨ Features

### Candidate Experience
- **Timed assessment** — language and difficulty selection, fullscreen-locked exam mode with anti-cheat guards
- **Monaco Editor** — production-grade code editing with syntax highlighting
- **Live code execution** — run against sample inputs via Judge0, instantly
- **Rich result page** — skill radar chart, behavioral heatmap, timeline replay, and AI narrative feedback

### Proctoring & Behavioral Intelligence
- **Webcam monitoring** — TensorFlow.js + BlazeFace for real-time head-position tracking
- **Keystroke telemetry** — captures typing speed, pauses, backspaces, rewrites, and hesitation patterns
- **Behavioral timeline** — visual chronology of focus, struggle, and momentum events
- **Line-level heatmap** — identifies exactly where a candidate struggled in their code

### Cognitive Scoring
MindCode evaluates candidates across five cognitive dimensions:

| Dimension | What It Measures |
|---|---|
| **Problem Solving** | Structural approach and logical decomposition |
| **Debugging** | Edit-revert cycles and error recovery |
| **Focus** | Sustained attention and distraction indicators |
| **Planning** | Code structure written before execution attempts |
| **Adaptability** | Response to failed test cases and strategy pivots |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CANDIDATE BROWSER                        │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────┐  │
│  │ Monaco Editor│  │  Webcam (BF/TF) │  │  Keystroke Tracker│  │
│  └──────┬───────┘  └────────┬────────┘  └────────┬──────────┘  │
│         └──────────────────┬┴─────────────────────┘            │
│                            │ React + Zustand                    │
└────────────────────────────┼────────────────────────────────────┘
                             │ HTTP / REST
┌────────────────────────────▼────────────────────────────────────┐
│                     NODE.JS / EXPRESS API                       │
│  /run   /question   /analysis   /generate-report                │
│  /generate-recommendations   /submit-code   /user-report        │
│  /recruiter-dashboard   /recruiter-report   /recruiter-analysis │
└────────┬───────────────────────────┬────────────────────────────┘
         │                           │
┌────────▼────────┐       ┌──────────▼──────────┐
│   Judge0 API    │       │   Supabase Postgres  │
│  Code Execution │       │  users · skill_tests │
└─────────────────┘       │  keystroke_logs      │
                          │  submissions         │
┌─────────────────┐       │  reports             │
│   Gemini / LLM  │──────▶│  recommendations     │
│  Report & Recs  │       │  emotion_logs        │
└─────────────────┘       └──────────────────────┘
```

---

## 📁 Project Structure

```
mind_code_new/
├── backend/
│   ├── server.js                   # Express API: Judge0 proxy, telemetry, reports, recommendations
│   ├── lib/
│   │   ├── keystrokeDatabase.mjs   # Keystroke persistence helpers
│   │   └── keystrokeRoutes.mjs     # Keystroke-specific API routes
│   ├── scripts/                    # Utility scripts
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Assessment.tsx      # Exam UI, timer, proctoring, submission flow
│   │   │   └── Result.tsx          # Radar chart, insights, verdict, report rendering
│   │   ├── hooks/
│   │   │   ├── useAssessmentSession.ts
│   │   │   └── useKeystrokeTracker.ts
│   │   ├── components/             # Shared UI components
│   │   └── lib/                    # Utilities and API clients
│   ├── supabase_schema.sql         # Full database schema
│   └── package.json
│
├── scripts/
│   └── dev.mjs                     # Concurrent backend + frontend runner
├── keystroke_logs_migration.sql    # Keystroke table migration
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| Supabase project | Any plan |
| Judge0 instance | Self-hosted or RapidAPI |
| Gemini / LLM API key | For report generation |

### 1. Clone and Install

```bash
git clone https://github.com/your-org/mindcode.git
cd mindcode
npm install
```

### 2. Configure Environment Variables

**Backend** — create `backend/.env`:

```env
PORT=3001

# Code execution
JUDGE0_URL=https://your-judge0-instance
JUDGE0_TOKEN=your_optional_token

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI report generation
BYTEZ_API_KEY=your_api_key
BYTEZ_MODEL=your_model_name
```

**Frontend** — create `frontend/.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SUPABASE_REDIRECT_TO=http://localhost:8080/auth/callback
VITE_CODE_RUNNER_URL=http://localhost:3001
VITE_AI_API_BASE=                  # Optional: custom AI base URL
```

### 3. Initialize the Database

Run the schema and migration files against your Supabase project:

```bash
# Via Supabase CLI
supabase db push --file frontend/supabase_schema.sql
supabase db push --file keystroke_logs_migration.sql

# Or paste directly into the Supabase SQL Editor
```

### 4. Start Development Servers

```bash
# Run both services concurrently (recommended)
npm run dev

# Or run individually
npm run dev:backend    # → http://localhost:3001
npm run dev:frontend   # → http://localhost:8080
```

---

## 🔌 API Reference

### Code Execution

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/run` | Execute code via Judge0 |
| `POST` | `/question` | Generate an assessment question |
| `POST` | `/analysis` | Compute code + telemetry analysis |

### Assessment Lifecycle

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/submit-code` | Persist final submission metadata |
| `POST` | `/generate-report` | Build cognitive profile → upsert to `reports` |
| `POST` | `/generate-recommendations` | Build AI feedback + study plan → upsert to `recommendations` |
| `GET` | `/user-report/:test_id` | Fetch latest report and recommendations for a test |

### Recruiter Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/recruiter-dashboard` | Aggregate candidate overview |
| `GET` | `/recruiter-report/:reportId` | Full cognitive report for a candidate |
| `GET` | `/recruiter-analysis` | Cross-candidate comparison data |

---

## 📊 Main User Flow

```
1. Candidate starts assessment
        │
        ▼
2. Frontend creates session → opens timed fullscreen exam
        │
        ├─ Webcam proctoring active (BlazeFace head-position)
        ├─ Keystroke telemetry streaming
        └─ Behavioral signals captured continuously
        │
        ▼
3. Candidate writes code in Monaco Editor
        │
        ▼
4. Candidate runs code → POST /run → Judge0 executes → result returned
        │
        ▼
5. Candidate submits
        │
        ├─ POST /submit-code        → persists submission
        ├─ POST /generate-report    → AI builds cognitive profile
        └─ POST /generate-recommendations → AI generates study plan
        │
        ▼
6. Result page loads
        │
        ├─ Skill radar chart (5 dimensions)
        ├─ Behavioral timeline
        ├─ Line-level struggle heatmap
        ├─ AI narrative feedback
        └─ PDF export available
```

---

## 🗄️ Database Schema

| Table | Description |
|---|---|
| `users` | Candidate and recruiter accounts |
| `skill_tests` | Assessment sessions and configuration |
| `keystroke_logs` | Raw keystroke telemetry (speed, pauses, rewrites) |
| `submissions` | Final code submissions with metadata |
| `reports` | AI-generated cognitive profiles |
| `recommendations` | Study plans, topic lists, practice questions |
| `emotion_logs` | Webcam-derived engagement signals |

Full schema: [`frontend/supabase_schema.sql`](frontend/supabase_schema.sql)
Migration: [`keystroke_logs_migration.sql`](keystroke_logs_migration.sql)

---

## 🧪 Testing & Development Utilities

```bash
# Frontend
cd frontend
npm run test           # Run test suite
npm run lint           # ESLint checks
npm run verify:supabase  # Verify Supabase connection and schema

# Backend
cd backend
npm run dev            # Start with hot-reload
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend framework** | React 18 + TypeScript + Vite |
| **Styling** | TailwindCSS + shadcn/ui + Radix UI |
| **State management** | Zustand |
| **Code editor** | Monaco Editor |
| **Charts** | Recharts |
| **Computer vision** | TensorFlow.js + BlazeFace |
| **Backend** | Node.js + Express |
| **Database** | Supabase (Postgres) |
| **Auth** | Supabase Auth (OAuth + email) |
| **Code execution** | Judge0 API |
| **AI / LLM** | Gemini (report and question generation) |

---

## 📏 Report Accuracy Notes

- **Assessment duration** is derived from telemetry timestamps in `keystroke_logs` — not wall-clock time — making it resistant to tab-switching or pausing.
- **Typing speed** is computed from keystroke counters with a sample-speed fallback for sparse sessions.
- **AI behavioral narratives** are grounded in these computed metrics so candidates always see realistic, specific feedback rather than generic summaries.

---

## 📚 Additional Documentation

| Document | Contents |
|---|---|
| [`KEYSTROKE_IMPLEMENTATION_GUIDE.md`](KEYSTROKE_IMPLEMENTATION_GUIDE.md) | How keystroke capture and scoring works |
| [`KEYSTROKE_SYSTEM_SUMMARY.md`](KEYSTROKE_SYSTEM_SUMMARY.md) | High-level telemetry system design |
| [`KEYSTROKE_TESTING_GUIDE.md`](KEYSTROKE_TESTING_GUIDE.md) | Testing keystroke collection end-to-end |
| [`BEHAVIORAL_TRACKING_IMPLEMENTATION.md`](BEHAVIORAL_TRACKING_IMPLEMENTATION.md) | Webcam + behavioral signal pipeline |
| [`AI_INSIGHTS_FIX.md`](AI_INSIGHTS_FIX.md) | Known issues and fixes for AI insight generation |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit with a clear message: `git commit -m "feat: add X"`
4. Push and open a Pull Request

Please ensure `npm run lint` passes and all existing tests are green before submitting.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  Built with ❤️ by the MindCode team
</div>

