import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import Bytez from 'bytez.js';
import 'dotenv/config';
import http from 'http';
import { attachCollaborationWebSocket, createCollaborationRouter } from './lib/collaboration.mjs';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const IS_VERCEL = process.env.VERCEL === '1';

// Judge0 CE public instance
const JUDGE0_URL = process.env.JUDGE0_URL || 'https://ce.judge0.com';

// Supabase client (service role for server-side writes)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Bytez/Qwen LLM (for question generation & analysis)
const BYTEZ_API_KEY = (process.env.BYTEZ_API_KEY || '').trim();
const BYTEZ_MODEL = encodeURIComponent(process.env.BYTEZ_MODEL || 'Qwen/Qwen3-4B');
const llm = BYTEZ_API_KEY ? new Bytez(BYTEZ_API_KEY).model(BYTEZ_MODEL) : null;

if (!llm) {
  console.warn('[Bytez] BYTEZ_API_KEY not set. Question generation/analysis will fail.');
}

if (!supabase) {
  console.warn('[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Telemetry will fail.');
} else {
  console.log('[Supabase] ✅ Initialized with service role key');
}

const recentQuestionSignatures = [];
const recentQuestionSignatureSet = new Set();
const MAX_RECENT_QUESTIONS = 20;
const recentQuestionTitles = [];
const recentQuestionTitleSet = new Set();
const MAX_RECENT_TITLES = 100;

const normalizeQuestionSignature = (question) => [
  question?.title,
  question?.problem,
  question?.input_format,
  question?.output_format,
].filter(Boolean).join(' | ').toLowerCase();

const rememberQuestion = (question) => {
  const signature = normalizeQuestionSignature(question);
  if (!signature) return false;
  if (recentQuestionSignatureSet.has(signature)) return false;
  recentQuestionSignatureSet.add(signature);
  recentQuestionSignatures.push(signature);
  while (recentQuestionSignatures.length > MAX_RECENT_QUESTIONS) {
    const oldest = recentQuestionSignatures.shift();
    if (oldest) recentQuestionSignatureSet.delete(oldest);
  }
  return true;
};

async function ensureSkillTestRecord({ user_id, test_id, language = 'python', difficulty = 'medium', question = 'Assessment session', topic = 'general' }) {
  if (!supabase || !user_id || !test_id) return;
  // Do not overwrite an existing test row, because it may already contain
  // user-selected topic/interest metadata from the assessment start flow.
  const { data: existing, error: existingError } = await supabase
    .from('skill_tests')
    .select('id')
    .eq('id', test_id)
    .maybeSingle();
  if (existingError) {
    console.warn('[ensureSkillTestRecord] lookup failed:', existingError.message);
  }
  if (existing?.id) return;

  const payload = {
    id: test_id,
    user_id,
    language,
    question,
    topic,
    difficulty,
    starter_code: '',
  };
  const { error } = await supabase.from('skill_tests').insert(payload);
  if (error && error.code !== '23505') {
    console.warn('[ensureSkillTestRecord] insert failed:', error.message);
  }
}

const upsertReportWithFallback = async (reportRow) => {
  const { data: existing, error: existingError } = await supabase
    .from('reports')
    .select('id')
    .eq('user_id', reportRow.user_id)
    .eq('test_id', reportRow.test_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from('reports')
      .update(reportRow)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (updateError) throw updateError;
    return updated?.id || existing.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('reports')
    .insert(reportRow)
    .select('id')
    .single();
  if (insertError) throw insertError;
  return inserted?.id || null;
};

const upsertRecommendationWithFallback = async (recRow) => {
  const { data: existing, error: existingError } = await supabase
    .from('recommendations')
    .select('id')
    .eq('user_id', recRow.user_id)
    .eq('test_id', recRow.test_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('recommendations')
      .update(recRow)
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabase
    .from('recommendations')
    .insert(recRow);
  if (insertError) throw insertError;
};

const normalizeTitleKey = (title) => String(title || '').trim().toLowerCase();

const rememberTitle = (title) => {
  const key = normalizeTitleKey(title);
  if (!key) return;
  recentQuestionTitleSet.add(key);
  recentQuestionTitles.push(key);
  while (recentQuestionTitles.length > MAX_RECENT_TITLES) {
    const oldest = recentQuestionTitles.shift();
    if (oldest) recentQuestionTitleSet.delete(oldest);
  }
};

const allocateUniqueTitle = (rawTitle, fallback = 'Beginner Coding Challenge') => {
  const base = String(rawTitle || '').trim() || fallback;
  let candidate = base;
  let idx = 2;
  while (recentQuestionTitleSet.has(normalizeTitleKey(candidate))) {
    candidate = `${base} #${idx}`;
    idx += 1;
  }
  rememberTitle(candidate);
  return candidate;
};

const parseOrigins = (value = '') => value
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  ...parseOrigins(process.env.CORS_ORIGINS || ''),
  ...parseOrigins(process.env.FRONTEND_URL || ''),
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const isAllowedOrigin = (origin = '') => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    console.error('[CORS] Blocked origin:', origin || '(none)');
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-role'],
  optionsSuccessStatus: 204,
};

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use('/api/collaboration', createCollaborationRouter({ supabase }));

app.use((req, _res, next) => {
  if (req.method === 'OPTIONS') {
    console.log('[CORS preflight]', {
      origin: req.headers.origin || null,
      method: req.headers['access-control-request-method'] || null,
      headers: req.headers['access-control-request-headers'] || null,
      path: req.originalUrl,
    });
  }
  next();
});

// Health check
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'SkillDNA Editor API' });
});

// Supabase connectivity check
app.get('/health/supabase', async (_req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase env missing' });
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true });
});

app.get('/health/cors', (req, res) => {
  const origin = req.headers.origin || null;
  const allowed = isAllowedOrigin(origin || '');
  res.json({
    ok: true,
    origin,
    allowed,
    credentials: corsOptions.credentials,
    allowedHeaders: corsOptions.allowedHeaders,
    allowedMethods: corsOptions.methods,
    configuredExactOrigins: [...allowedOrigins],
    vercelWildcardEnabled: true,
  });
});

/**
 * POST /run
 * Body: { code: string, language_id: number, stdin?: string }
 * Returns: { output, error, status, time, memory }
 */
const handleCodeRun = async (req, res) => {
  const { code, language_id, stdin = '' } = req.body;

  if (!code || !language_id) {
    return res.status(400).json({ error: 'Missing required fields: code, language_id' });
  }

  try {
    // Submit to Judge0 with wait=true for synchronous response
    const response = await axios.post(
      `${JUDGE0_URL}/submissions?wait=true&base64_encoded=false`,
      {
        source_code: code,
        language_id: Number(language_id),
        stdin,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': process.env.JUDGE0_TOKEN || undefined,
        },
        timeout: 15000,
      }
    );

    const data = response.data;

    return res.json({
      output: data.stdout || '',
      error: data.stderr || data.compile_output || '',
      status: data.status?.description || 'Unknown',
      statusId: data.status?.id,
      time: data.time,
      memory: data.memory,
    });
  } catch (err) {
    console.error('[Judge0 Error]', err?.response?.data || err.message);

    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Execution timed out.' });
    }

    return res.status(500).json({
      error: err?.response?.data?.message || err.message || 'Internal server error',
    });
  }
};

app.post('/run', handleCodeRun);
app.post('/execute', handleCodeRun);

// ────────────────────────────────────────────────────────────
// Behavior tracking schemas
// ────────────────────────────────────────────────────────────
const baseEventSchema = z.object({
  user_id: z.string().min(1),
  test_id: z.string().min(1),
  timestamp: z.string().datetime().optional(),
});

const keystrokeSchema = baseEventSchema.extend({
  typing_speed: z.number().nonnegative().optional(),
  pause_duration: z.number().nonnegative(),
  backspace_count: z.number().nonnegative().optional(),
  cursor_position: z.number().int().nonnegative().nullable(), // column number
  line_number: z.number().int().nonnegative().nullable(),
  code_snapshot: z.string().optional(),
  key_pressed: z.any().optional(),
  action_type: z.string().optional(),
  code_length: z.number().int().nonnegative().optional(),
  line_time_ms: z.number().nonnegative().optional(),
  idle_ms: z.number().nonnegative().optional(),
  error_count: z.number().int().nonnegative().optional(),
  paste_detected: z.boolean().optional(),
  pasted_char_count: z.number().int().nonnegative().optional(),
  pasted_line_count: z.number().int().nonnegative().optional(),
  sudden_code_jump: z.boolean().optional(),
  prev_line_number: z.number().int().nonnegative().nullable().optional(),
  word_count: z.number().int().nonnegative().optional(),
  problem_id: z.string().optional(),
  burst_insert_detected: z.boolean().optional(),
  is_paste_event: z.boolean().optional(),
  // Behavior block fields (for behavior_block_summary action_type)
  keystroke_count: z.number().int().nonnegative().optional(),
  pause_duration_ms: z.number().nonnegative().optional(),
  typing_speed_avg: z.number().nonnegative().optional(),
  hesitation_count: z.number().int().nonnegative().optional(),
  error_recovery_time_ms: z.number().nonnegative().optional(),
  line_rewrites: z.number().int().nonnegative().optional(),
  code_rewrite_count: z.number().int().nonnegative().optional(),
  deletion_bursts: z.number().int().nonnegative().optional(),
  block_duration_ms: z.number().nonnegative().optional(),
  focus_level: z.number().min(0).max(1).optional(),
  is_completing: z.boolean().optional(),
});

// Behavior blocks — comprehensive behavioral snapshot
const behaviorBlockSchema = baseEventSchema.extend({
  keystroke_count: z.number().int().nonnegative(),
  backspace_count: z.number().int().nonnegative().optional(),
  pause_duration_ms: z.number().nonnegative().optional(),
  typing_speed_avg: z.number().nonnegative().optional(),
  paste_detected: z.boolean().optional(),
  pasted_char_count: z.number().int().nonnegative().optional(),
  pasted_line_count: z.number().int().nonnegative().optional(),
  idle_ms: z.number().nonnegative().optional(),
  hesitation_count: z.number().int().nonnegative().optional(),
  error_count: z.number().int().nonnegative().optional(),
  error_recovery_time_ms: z.number().nonnegative().optional(),
  line_rewrites: z.number().int().nonnegative().optional(),
  code_rewrite_count: z.number().int().nonnegative().optional(),
  deletion_bursts: z.number().int().nonnegative().optional(),
  code_snapshot: z.string().optional(),
  block_duration_ms: z.number().nonnegative(),
  focus_level: z.number().min(0).max(1).optional(),
  is_completing: z.boolean().optional(),
});

const emotionSchema = baseEventSchema.extend({
  emotion: z.string().min(1),
  confidence: z.number().min(0).max(1),
  gaze_state: z.enum(['focused', 'away', 'blinking', 'unknown']).optional(),
});

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
const mapKeystrokePayload = (data = {}) => {
  const idleValue = typeof data.idle_ms === 'number'
    ? data.idle_ms
    : (typeof data.idle_time_ms === 'number' ? data.idle_time_ms : null);
  const pastedChars = Number.isInteger(data.pasted_char_count)
    ? data.pasted_char_count
    : (Number.isInteger(data.paste_char_count) ? data.paste_char_count : 0);
  const pastedLines = Number.isInteger(data.pasted_line_count)
    ? data.pasted_line_count
    : (Number.isInteger(data.paste_line_count) ? data.paste_line_count : 0);

  return {
    user_id: data.user_id,
    test_id: data.test_id || null,
    timestamp: data.timestamp || new Date().toISOString(),
    typing_speed: typeof data.typing_speed === 'number' ? data.typing_speed : null,
    pause_duration: typeof data.pause_duration === 'number'
      ? data.pause_duration
      : (typeof data.pause_duration_ms === 'number' ? data.pause_duration_ms : 0),
    pause_duration_ms: typeof data.pause_duration_ms === 'number' ? data.pause_duration_ms : null,
    backspace_count: typeof data.backspace_count === 'number' ? data.backspace_count : 0,
    cursor_position: Number.isInteger(data.cursor_position) ? data.cursor_position : null,
    line_number: Number.isInteger(data.line_number) ? data.line_number : null,
    prev_line_number: Number.isInteger(data.prev_line_number) ? data.prev_line_number : null,
    action_type: typeof data.action_type === 'string' ? data.action_type.slice(0, 64) : null,
    code_length: Number.isInteger(data.code_length) ? data.code_length : null,
    line_time_ms: typeof data.line_time_ms === 'number' ? data.line_time_ms : null,
    idle_time_ms: idleValue,
    idle_ms: idleValue,
    error_count: Number.isInteger(data.error_count) ? data.error_count : 0,
    is_paste_event: typeof data.is_paste_event === 'boolean' ? data.is_paste_event : false,
    paste_line_count: pastedLines,
    paste_char_count: pastedChars,
    burst_insert_detected: typeof data.burst_insert_detected === 'boolean' ? data.burst_insert_detected : false,
    word_count: Number.isInteger(data.word_count) ? data.word_count : null,
    paste_detected: typeof data.paste_detected === 'boolean' ? data.paste_detected : false,
    pasted_line_count: pastedLines,
    pasted_char_count: pastedChars,
    sudden_code_jump: typeof data.sudden_code_jump === 'boolean' ? data.sudden_code_jump : false,
    key_pressed: typeof data.key_pressed === 'string' ? data.key_pressed.slice(0, 256) : null,
    keystroke_count: Number.isInteger(data.keystroke_count) ? data.keystroke_count : null,
    typing_speed_avg: typeof data.typing_speed_avg === 'number' ? data.typing_speed_avg : null,
    hesitation_count: Number.isInteger(data.hesitation_count) ? data.hesitation_count : null,
    error_recovery_time_ms: typeof data.error_recovery_time_ms === 'number' ? data.error_recovery_time_ms : null,
    line_rewrites: Number.isInteger(data.line_rewrites) ? data.line_rewrites : null,
    code_rewrite_count: Number.isInteger(data.code_rewrite_count) ? data.code_rewrite_count : null,
    deletion_bursts: Number.isInteger(data.deletion_bursts) ? data.deletion_bursts : null,
    block_duration_ms: typeof data.block_duration_ms === 'number' ? data.block_duration_ms : null,
    focus_level: typeof data.focus_level === 'number' ? clamp(data.focus_level, 0, 1) : null,
    is_completing: typeof data.is_completing === 'boolean' ? data.is_completing : false,
    code_snapshot: typeof data.code_snapshot === 'string' ? data.code_snapshot.slice(0, 12000) : null,
  };
};

async function insertKeystroke(data) {
  if (!supabase) throw new Error('Supabase not configured');
  const payload = mapKeystrokePayload(data);

  console.log('[insertKeystroke] Payload:', { user_id: payload.user_id, test_id: payload.test_id, action_type: payload.action_type, keystroke_count: payload.keystroke_count, is_paste_event: payload.is_paste_event });

  const attemptInsert = async (inputPayload) => {
    console.log('[insertKeystroke] Attempting insert with payload keys:', Object.keys(inputPayload));
    const { error } = await supabase.from('keystroke_logs').insert(inputPayload);
    return error;
  };
  let error = await attemptInsert(payload);
  if (!error) {
    console.log('[insertKeystroke] ✅ Insert successful');
    return;
  }

  console.error('[insertKeystroke] Full error details:', { code: error.code, message: error.message, details: error.details, hint: error.hint });

  // Graceful compatibility for projects where new telemetry columns are not migrated yet.
  if (error.code === 'PGRST204' || error.code === '42703') {
    const minimal = {
      user_id: payload.user_id,
      test_id: payload.test_id,
      timestamp: payload.timestamp,
      typing_speed: payload.typing_speed,
      pause_duration: payload.pause_duration,
      backspace_count: payload.backspace_count,
      cursor_position: payload.cursor_position,
      code_snapshot: payload.code_snapshot,
      keystroke_count: payload.keystroke_count,
    };
    error = await attemptInsert(minimal);
    if (!error) {
      console.warn('[insertKeystroke] ⚠️ Fell back to minimal schema due to missing columns');
      return;
    }
  }

  // If test_id FK is missing, keep the telemetry by dropping test_id.
  if (error.code === '23503') {
    const fallback = { ...payload, test_id: null };
    let retryError = await attemptInsert(fallback);
    if (retryError && (retryError.code === 'PGRST204' || retryError.code === '42703')) {
      retryError = await attemptInsert({
        user_id: fallback.user_id,
        test_id: null,
        timestamp: fallback.timestamp,
        typing_speed: fallback.typing_speed,
        pause_duration: fallback.pause_duration,
        backspace_count: fallback.backspace_count,
        cursor_position: fallback.cursor_position,
        code_snapshot: fallback.code_snapshot,
      });
    }
    if (!retryError) return;
    throw retryError;
  }

  throw error;
}

async function insertEmotion(data) {
  if (!supabase) throw new Error('Supabase not configured');
  const payload = {
    user_id: data.user_id,
    test_id: data.test_id,
    timestamp: data.timestamp || new Date().toISOString(),
    emotion: data.emotion,
    confidence: data.confidence,
  };
  const { error } = await supabase.from('emotion_logs').insert(payload);
  if (!error) return;

  if (error.code === '23503') {
    const fallback = { ...payload, test_id: null };
    const { error: retryError } = await supabase.from('emotion_logs').insert(fallback);
    if (!retryError) return;
    throw retryError;
  }

  throw error;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function computeAnalysis({ user_id, test_id, language, question, code }) {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Validate code is meaningful (not gibberish)
  const codeMeaningful = isCodeMeaningful(code, language);

  const [{ data: keystrokes }, { data: emotions }] = await Promise.all([
    supabase.from('keystroke_logs')
      .select('typing_speed,pause_duration,backspace_count,cursor_position,line_number,code_snapshot,timestamp')
      .eq('user_id', user_id).eq('test_id', test_id).order('timestamp'),
    supabase.from('emotion_logs')
      .select('emotion,confidence,timestamp,gaze_state')
      .eq('user_id', user_id).eq('test_id', test_id).order('timestamp'),
  ]);

  // Check if there's meaningful telemetry data
  const hasMeaningfulData = ((keystrokes?.length || 0) > 5 || (emotions?.length || 0) > 2) && codeMeaningful;

  const heatmap = {};
  let avgSpeed = 0;
  let pauses = 0;
  let backspaces = 0;

  keystrokes?.forEach((k, idx) => {
    avgSpeed += k.typing_speed || 0;
    pauses += k.pause_duration || 0;
    backspaces += k.backspace_count || 0;
    const lineKey = k.line_number != null
      ? Number(k.line_number)
      : (k.cursor_position != null ? Number(k.cursor_position) : null);
    if (lineKey != null && Number.isFinite(lineKey) && lineKey > 0) {
      const key = Math.round(lineKey);
      heatmap[key] = (heatmap[key] || 0) + (k.backspace_count || 0) + (k.pause_duration > 1500 ? 1 : 0);
    }
    // thin snapshots to reduce payload
    if (idx % 50 === 0 && k.code_snapshot) {
      heatmap.lastSnapshot = k.code_snapshot.slice(0, 4000);
    }
  });

  const total = Math.max(keystrokes?.length || 1, 1);
  const avgPause = pauses / total;
  avgSpeed = avgSpeed / total;

  const emotionCounts = emotions?.reduce((acc, e) => {
    acc[e.emotion] = (acc[e.emotion] || 0) + 1;
    return acc;
  }, {}) || {};
  const dominantEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  let codeReview = null;
  if (language && question && code && llm && hasMeaningfulData && codeMeaningful) {
    try {
      const system = 'You are a strict code reviewer. Score logic correctness and syntax/style from 0-100. Return JSON: { logic_score, syntax_score, feedback }. Only JSON.';
      const user = `Problem:\n${question}\n\nLanguage: ${language}\nCandidate solution:\n${code}\n\nScore logic correctness and syntax/style.`;
      const raw = await callLLM([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      const parsed = parseJsonLoose(raw);
      if (parsed) {
        codeReview = {
          logic_score: Number(parsed.logic_score) || null,
          syntax_score: Number(parsed.syntax_score) || null,
          feedback: String(parsed.feedback || ''),
        };
      }
    } catch (err) {
      console.warn('[computeAnalysis] code review failed', err?.message || err);
    }
  }

  const telemetryScores = {
    debugging: clamp(100 - backspaces * 0.8, 20, 97),
    focus: clamp(100 - (emotionCounts.distracted || 0) * 5 - (avgPause / 2000) * 10, 20, 97),
    planning: clamp(40 + avgPause / 10 + (avgSpeed < 3 ? 10 : 0), 20, 95),
    flexibility: clamp(90 - (emotionCounts.frustrated || 0) * 6, 30, 96),
  };

  const logicBoost = codeReview?.logic_score != null ? (codeReview.logic_score - 50) * 0.55 : 0;
  const syntaxBoost = codeReview?.syntax_score != null ? (codeReview.syntax_score - 50) * 0.45 : 0;

  const scores = {
    problemSolving: clamp(telemetryScores.planning + logicBoost, 20, 98),
    debugging: clamp(telemetryScores.debugging + syntaxBoost, 20, 98),
    focus: telemetryScores.focus,
    planning: clamp(telemetryScores.planning + logicBoost * 0.7, 20, 98),
    adaptability: clamp(telemetryScores.flexibility + syntaxBoost * 0.25, 20, 98),
  };

  // Generate AI-powered insights only when there's meaningful data AND code is valid
  let insights = { strengths: [], weaknesses: [], summary: 'No meaningful data to analyze. Run code and submit solutions to unlock insights.' };

  if (hasMeaningfulData && codeMeaningful) {
    insights = await generateContextAwareInsights(scores, codeReview, dominantEmotion, emotionCounts, avgSpeed, avgPause, backspaces);
  }

  const summary = [
    `Dominant emotion: ${dominantEmotion}`,
    `Avg typing speed: ${avgSpeed.toFixed(2)} chars/s`,
    `Avg pause: ${(avgPause / 1000).toFixed(2)}s`,
    `Backspaces: ${backspaces}`,
    codeReview?.feedback ? `Code review: ${codeReview.feedback}` : null,
  ].join(' · ');

  const heatmapData = Object.entries(heatmap)
    .filter(([k]) => k !== 'lastSnapshot')
    .map(([line, weight]) => ({ line: Number(line), weight }));

  return {
    scores,
    heatmap_data: heatmapData,
    summary,
    emotion_counts: emotionCounts,
    last_snapshot: heatmap.lastSnapshot,
    dominant_emotion: dominantEmotion,
    code_review: codeReview,
    telemetry: {
      avg_speed: avgSpeed,
      avg_pause_seconds: avgPause,
      backspaces,
    },
    insights, // Include structured insights
  };
}

// Generate context-aware insights using Qwen AI
async function generateContextAwareInsights(scores, codeReview, emotion, emotionCounts, avgSpeed, avgPause, backspaces) {
  const strengths = [];
  const weaknesses = [];

  // Extract strengths (scores >= 80)
  if (scores.focus >= 80) strengths.push(`Sustained Focus: ${Math.round(scores.focus)}% - maintained attention throughout session`);
  if (scores.debugging >= 80) strengths.push(`Strong Debugging: ${Math.round(scores.debugging)}% - efficient error detection`);
  if (scores.adaptability >= 80) strengths.push(`Good Adaptability: ${Math.round(scores.adaptability)}% - quickly adjusted approach`);
  if (scores.planning >= 80) strengths.push(`Solid Planning: ${Math.round(scores.planning)}% - methodical problem approach`);
  if (scores.problemSolving >= 80) strengths.push(`Problem Solving: ${Math.round(scores.problemSolving)}% - effective solutions`);

  // Extract weaknesses (scores < 80)
  if (scores.focus < 80) weaknesses.push(`Focus Lapses: ${Math.round(scores.focus)}% - maintain concentration`);
  if (scores.debugging < 80) weaknesses.push(`Debugging Skills: ${Math.round(scores.debugging)}% - reduce trial-and-error`);
  if (scores.adaptability < 80) weaknesses.push(`Adaptability: ${Math.round(scores.adaptability)}% - be more flexible with approaches`);
  if (scores.planning < 80) weaknesses.push(`Planning: ${Math.round(scores.planning)}% - plan more before coding`);
  if (scores.problemSolving < 80) weaknesses.push(`Problem Solving: ${Math.round(scores.problemSolving)}% - break problems into smaller steps`);

  // Use Qwen for enhanced feedback if available
  let enhancedSummary = `Session dominated by ${emotion} emotion. `;

  if (llm && codeReview) {
    try {
      const prompt = `Given coding session metrics - focus:${Math.round(scores.focus)}, debugging:${Math.round(scores.debugging)}, emotion:${emotion}, avg_typing_speed:${avgSpeed.toFixed(1)}chars/s, backspaces:${backspaces} - provide 1-2 sentence improvement suggestion. Keep it practical and actionable.`;
      const feedbackRaw = await callLLM([
        { role: 'user', content: prompt }
      ]);
      if (feedbackRaw) enhancedSummary += feedbackRaw.slice(0, 150);
    } catch (err) {
      console.warn('[generateContextAwareInsights] Qwen feedback failed', err?.message);
    }
  }

  return {
    strengths: strengths.length > 0 ? strengths.slice(0, 3) : ['Keep practicing - insights will appear after more sessions'],
    weaknesses: weaknesses.length > 0 ? weaknesses.slice(0, 3) : [],
    summary: enhancedSummary,
  };
}

// Helper: Check if code is meaningful (not gibberish)
function isCodeMeaningful(code, language) {
  if (!code || typeof code !== 'string') return false;

  const trimmed = code.trim();
  if (trimmed.length < 10) return false; // Too short

  // Check for actual code patterns (functions, loops, conditionals, keywords)
  const codePatterns = {
    python: /\b(def|class|if|for|while|return|import|from)\b|:/,
    javascript: /\b(function|const|let|var|if|for|while|return|class|=>)\b|\{|}|;/,
    java: /\b(public|class|static|void|return|if|for|while)\b|\{|}|;/,
    cpp: /\b(int|void|for|while|if|return|using|namespace)\b|[{}();]/,
    c: /\b(int|void|for|while|if|return|include)\b|[{}();]/,
    go: /\b(func|package|import|return|if|for|range)\b|\{|}|:=/,
    rust: /\b(fn|let|pub|impl|trait|return|match)\b|[{}();]/,
  };

  const pattern = codePatterns[language.toLowerCase()] || codePatterns.python;
  const hasCodeStructure = pattern.test(trimmed);

  if (!hasCodeStructure) return false;

  // Check that it's not mostly gibberish (random repeated characters)
  const repeatedChars = trimmed.match(/(.)\1{5,}/g) || [];
  const gibberishRatio = (repeatedChars.join('').length || 0) / trimmed.length;
  if (gibberishRatio > 0.3) return false; // More than 30% repeated chars = gibberish

  return true;
}

// Helper: Detect if code execution failed due to syntax error
function hasExecutionError(actual) {
  if (!actual || typeof actual !== 'string') return false;
  const actual_lower = actual.toLowerCase();
  // Check for common error indicators
  return /error|traceback|exception|undefined|syntaxerror|referenceerror|nameerror/i.test(actual_lower);
}

const callLLM = async (messages) => {
  if (!llm) throw new Error('LLM not configured');
  const response = await llm.run(messages);
  const candidates = [];
  const pushCandidate = (v) => {
    if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
  };

  const extractFromNode = (node, depth = 0) => {
    if (node == null || depth > 6) return;
    if (typeof node === 'string') return pushCandidate(node);
    if (Array.isArray(node)) {
      node.forEach((entry) => extractFromNode(entry, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    // Prioritize actual model output-bearing keys.
    const preferredKeys = ['output_text', 'text', 'content', 'message', 'result', 'completion'];
    preferredKeys.forEach((key) => extractFromNode(node[key], depth + 1));

    // Some SDKs nest text in content blocks [{ type, text }].
    if (Array.isArray(node?.content)) {
      node.content.forEach((chunk) => {
        extractFromNode(chunk?.text, depth + 1);
        extractFromNode(chunk?.content, depth + 1);
        extractFromNode(chunk?.value, depth + 1);
      });
    }
  };

  // Only inspect known output surfaces; avoid traversing entire response object
  // because it can include echoed prompt text.
  extractFromNode(response?.output_text);
  extractFromNode(response?.text);
  extractFromNode(response?.result);
  extractFromNode(response?.output);
  extractFromNode(response?.message);

  const text = candidates.sort((a, b) => b.length - a.length)[0] || '';
  return (text || '').replace(/```json|```/g, '').trim();
};


const extractFirstJsonObject = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const text = raw.trim();
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return '';
};

const parseJsonLoose = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const objectLike = extractFirstJsonObject(raw);
    if (objectLike) {
      try {
        return JSON.parse(objectLike);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
};

const ensureString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const ensureStringArray = (value) => (Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : []);
const ensureSamples = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((sample) => ({
      input: ensureString(sample?.input),
      output: ensureString(sample?.output),
      explanation: ensureString(sample?.explanation),
    }))
    .filter((sample) => sample.input || sample.output || sample.explanation);
};

const normalizeGeneratedQuestion = (question, language, level) => {
  const normalized = {
    title: ensureString(question?.title || question?.name || question?.question_title),
    difficulty: ensureString(question?.difficulty || level, level),
    language: ensureString(question?.language || language, language),
    problem: ensureString(question?.problem || question?.description || question?.question || question?.prompt),
    input_format: ensureString(question?.input_format || question?.input || question?.inputFormat),
    output_format: ensureString(question?.output_format || question?.output || question?.outputFormat),
    constraints: ensureStringArray(question?.constraints || question?.constraint),
    samples: ensureSamples(question?.samples || question?.examples || question?.test_cases),
    topic_key: ensureString(question?.topic_key),
  };
  return normalized;
};

const hasQuestionMinimumShape = (question) => Boolean(question?.title && question?.problem);

async function repairQuestionJson(raw, language, level, easyTopicKey = '') {
  if (!raw) return null;
  const repairSystem = 'Convert the given content into STRICT valid JSON only. No markdown, no prose.';
  const repairUser = `Return only JSON with keys: title, difficulty, language, problem, input_format, output_format, constraints (array), samples (array of {input,output,explanation})${easyTopicKey ? ', topic_key' : ''}.
Difficulty must be "${level}".
Language must be "${language}".
${easyTopicKey ? `topic_key must be "${easyTopicKey}".` : ''}
Source content:
${String(raw).slice(0, 5000)}`;
  try {
    const repairedRaw = await callLLM([
      { role: 'system', content: repairSystem },
      { role: 'user', content: repairUser },
    ]);
    return parseJsonLoose(repairedRaw);
  } catch (_) {
    return null;
  }
}

async function regenerateStrictJsonQuestion({ language, level, easyTopicKey = '', topicPrompt = '' }) {
  const system = 'Return STRICT JSON ONLY. No prose. No markdown. One JSON object only.';
  const user = `Generate exactly one ${level} coding question in ${language}.
Return JSON with keys: title, difficulty, language, problem, input_format, output_format, constraints (array), samples (array of {input,output,explanation})${easyTopicKey ? ', topic_key' : ''}.
Difficulty must be "${level}".
Language must be "${language}".
${easyTopicKey ? `topic_key must be "${easyTopicKey}".` : ''}
${topicPrompt ? `Topic requirement: ${topicPrompt}` : ''}
Keep it beginner friendly with simple loops/conditions/math only.`;

  try {
    const raw = await callLLM([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return parseJsonLoose(raw);
  } catch (_) {
    return null;
  }
}

const EASY_TOPIC_KEYS = {
  FOR_LOOP: 'for_loop',
  EVEN_ODD: 'even_odd',
  FIBONACCI: 'fibonacci',
  FACTORIAL: 'factorial',
  IF_ELSE: 'if_else',
  RANGE_PRINT: 'range_print',
  DIVISIBLE_PRINT: 'divisible_print',
};

const EASY_TOPIC_DEFAULTS = {
  [EASY_TOPIC_KEYS.FOR_LOOP]: {
    input_format: 'A single integer n.',
    output_format: 'Print values as required by the loop pattern.',
    constraints: ['1 <= n <= 1000'],
    samples: [{ input: '5', output: '1 2 3 4 5', explanation: 'Print numbers from 1 to n.' }],
  },
  [EASY_TOPIC_KEYS.EVEN_ODD]: {
    input_format: 'A single integer n.',
    output_format: 'Print EVEN if n is even, else print ODD.',
    constraints: ['-10^9 <= n <= 10^9'],
    samples: [{ input: '14', output: 'EVEN', explanation: '14 is divisible by 2.' }],
  },
  [EASY_TOPIC_KEYS.FIBONACCI]: {
    input_format: 'A single integer n.',
    output_format: 'Print the first n Fibonacci numbers separated by space.',
    constraints: ['1 <= n <= 30'],
    samples: [{ input: '6', output: '0 1 1 2 3 5', explanation: 'First six Fibonacci numbers.' }],
  },
  [EASY_TOPIC_KEYS.FACTORIAL]: {
    input_format: 'A single integer n.',
    output_format: 'Print n factorial.',
    constraints: ['0 <= n <= 12'],
    samples: [{ input: '5', output: '120', explanation: '5! = 120.' }],
  },
  [EASY_TOPIC_KEYS.IF_ELSE]: {
    input_format: 'A single integer n.',
    output_format: 'Print output based on if-else condition described in the problem.',
    constraints: ['-10^6 <= n <= 10^6'],
    samples: [{ input: '7', output: 'POSITIVE', explanation: 'If n > 0 print POSITIVE.' }],
  },
  [EASY_TOPIC_KEYS.RANGE_PRINT]: {
    input_format: 'Two integers a and b.',
    output_format: 'Print all integers from a to b inclusive.',
    constraints: ['-10^4 <= a, b <= 10^4'],
    samples: [{ input: '3 7', output: '3 4 5 6 7', explanation: 'Inclusive range.' }],
  },
  [EASY_TOPIC_KEYS.DIVISIBLE_PRINT]: {
    input_format: 'Three integers a, b, k.',
    output_format: 'Print all numbers between a and b divisible by k.',
    constraints: ['1 <= k <= 10^3', '-10^4 <= a, b <= 10^4'],
    samples: [{ input: '1 15 3', output: '3 6 9 12 15', explanation: 'Multiples of 3 in range.' }],
  },
};

const cleanQuestionText = (raw) => String(raw || '')
  .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
  .replace(/\r/g, '')
  .trim();

const inferTitleFromText = (raw, fallback = 'Easy Coding Challenge') => {
  const text = cleanQuestionText(raw);
  if (!text) return fallback;
  const line = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l && l.length >= 4 && l.length <= 90);
  if (!line) return fallback;
  return line.replace(/\.$/, '');
};

const buildEasyQuestionFromPlainText = (raw, language, topicKey) => {
  const text = cleanQuestionText(raw);
  if (!text || text.length < 8) return null;
  const defaults = EASY_TOPIC_DEFAULTS[topicKey] || EASY_TOPIC_DEFAULTS[EASY_TOPIC_KEYS.FOR_LOOP];
  return {
    title: inferTitleFromText(text, 'Easy Coding Challenge'),
    difficulty: 'easy',
    language,
    problem: text,
    input_format: defaults.input_format,
    output_format: defaults.output_format,
    constraints: defaults.constraints,
    samples: defaults.samples,
    topic_key: topicKey,
    source: 'qwen-plaintext-recovered',
  };
};

const buildEasyFallbackQuestion = (language, topicKey) => {
  const defaults = EASY_TOPIC_DEFAULTS[topicKey] || EASY_TOPIC_DEFAULTS[EASY_TOPIC_KEYS.FOR_LOOP];
  const byKey = {
    [EASY_TOPIC_KEYS.FOR_LOOP]: {
      title: 'Loop Counter Basics',
      problem: 'Given an integer n, print numbers from 1 to n using a loop.',
    },
    [EASY_TOPIC_KEYS.EVEN_ODD]: {
      title: 'Even Odd Checker',
      problem: 'Given an integer n, print EVEN if n is even, otherwise print ODD.',
    },
    [EASY_TOPIC_KEYS.FIBONACCI]: {
      title: 'Print Fibonacci Sequence',
      problem: 'Given n, print the first n Fibonacci numbers separated by spaces.',
    },
    [EASY_TOPIC_KEYS.FACTORIAL]: {
      title: 'Simple Factorial',
      problem: 'Given a non-negative integer n, compute and print n factorial.',
    },
    [EASY_TOPIC_KEYS.IF_ELSE]: {
      title: 'If Else Number Classifier',
      problem: 'Given n, print POSITIVE if n > 0, NEGATIVE if n < 0, else ZERO.',
    },
    [EASY_TOPIC_KEYS.RANGE_PRINT]: {
      title: 'Print Numbers In Range',
      problem: 'Given a and b, print all integers from a to b inclusive.',
    },
    [EASY_TOPIC_KEYS.DIVISIBLE_PRINT]: {
      title: 'Divisible Numbers In Range',
      problem: 'Given a, b, and k, print all numbers between a and b divisible by k.',
    },
  };
  const item = byKey[topicKey] || byKey[EASY_TOPIC_KEYS.FOR_LOOP];
  return {
    title: item.title,
    difficulty: 'easy',
    language,
    problem: item.problem,
    input_format: defaults.input_format,
    output_format: defaults.output_format,
    constraints: defaults.constraints,
    samples: defaults.samples,
    topic_key: topicKey,
    source: 'easy-safe-fallback',
  };
};

const EASY_TOPIC_CATALOG = [
  'for loop',
  'even/odd',
  'fibonacci',
  'factorial',
  'if else',
  'print numbers in a range',
  'print numbers divisible by a given number',
];

const EASY_TOPIC_PROMPTS = [
  {
    key: EASY_TOPIC_KEYS.FOR_LOOP,
    label: 'for loop',
    prompt: 'Create a beginner problem that requires using a for loop for counting or repetition only.',
  },
  {
    key: EASY_TOPIC_KEYS.EVEN_ODD,
    label: 'even/odd',
    prompt: 'Create a beginner problem where the main task is classifying numbers as even or odd.',
  },
  {
    key: EASY_TOPIC_KEYS.FIBONACCI,
    label: 'fibonacci',
    prompt: 'Create a beginner problem focused on generating or printing fibonacci numbers.',
  },
  {
    key: EASY_TOPIC_KEYS.FACTORIAL,
    label: 'factorial',
    prompt: 'Create a beginner problem focused on factorial computation.',
  },
  {
    key: EASY_TOPIC_KEYS.IF_ELSE,
    label: 'if else',
    prompt: 'Create a beginner problem primarily testing if-else decision logic.',
  },
  {
    key: EASY_TOPIC_KEYS.RANGE_PRINT,
    label: 'print numbers in a range',
    prompt: 'Create a beginner problem where output is numbers printed in a specific range.',
  },
  {
    key: EASY_TOPIC_KEYS.DIVISIBLE_PRINT,
    label: 'print numbers divisible by a given number',
    prompt: 'Create a beginner problem where output is numbers divisible by a given divisor in a range.',
  },
];

const EASY_TOPIC_RULES = [
  { name: 'for loop', patterns: [/\bfor\s+loop\b/i, /\bfor\b[\s\S]{0,40}\brange\b/i, /\biterate\b/i] },
  { name: 'even/odd', patterns: [/\beven\b/i, /\bodd\b/i] },
  { name: 'fibonacci', patterns: [/\bfibonacci\b/i] },
  { name: 'factorial', patterns: [/\bfactorial\b/i] },
  { name: 'if else', patterns: [/\bif[-\s]?else\b/i, /\bif\b[\s\S]{0,40}\belse\b/i] },
  { name: 'print numbers in a range', patterns: [/\brange\b/i, /\bbetween\b/i] },
  { name: 'print numbers divisible by a given number', patterns: [/\bdivisible\b/i, /\bmultiple\b/i] },
];

const isEasyLevel = (level) => String(level || '').toLowerCase() === 'easy';

const EASY_TOPIC_BANNED_PATTERNS = [
  /\bgraph\b/i,
  /\btree\b/i,
  /\bdynamic programming\b/i,
  /\bdp\b/i,
  /\bsliding window\b/i,
  /\btwo[-\s]?pointers?\b/i,
  /\bheap\b/i,
  /\bsegment tree\b/i,
  /\btrie\b/i,
];

const inferEasyTopicKey = (question) => {
  const normalized = String(question?.topic_key || '').trim().toLowerCase();
  if (Object.values(EASY_TOPIC_KEYS).includes(normalized)) return normalized;

  const text = [
    question?.title,
    question?.problem,
    question?.input_format,
    question?.output_format,
    ...(Array.isArray(question?.constraints) ? question.constraints : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bfibonacci\b/i.test(text)) return EASY_TOPIC_KEYS.FIBONACCI;
  if (/\bfactorial\b/i.test(text)) return EASY_TOPIC_KEYS.FACTORIAL;
  if (/\beven\b/i.test(text) || /\bodd\b/i.test(text)) return EASY_TOPIC_KEYS.EVEN_ODD;
  if (/\bdivisible\b/i.test(text) || /\bmultiple\b/i.test(text)) return EASY_TOPIC_KEYS.DIVISIBLE_PRINT;
  if (/\brange\b/i.test(text) || /\bbetween\b/i.test(text)) return EASY_TOPIC_KEYS.RANGE_PRINT;
  if (/\bif[-\s]?else\b/i.test(text) || /\bif\b[\s\S]{0,40}\belse\b/i.test(text)) return EASY_TOPIC_KEYS.IF_ELSE;
  if (/\bfor\s+loop\b/i.test(text) || /\bfor\b[\s\S]{0,40}\brange\b/i.test(text) || /\biterate\b/i.test(text)) {
    return EASY_TOPIC_KEYS.FOR_LOOP;
  }
  return '';
};

const isEasyQuestionAllowed = (question) => {
  const text = [
    question?.title,
    question?.problem,
    question?.input_format,
    question?.output_format,
    ...(Array.isArray(question?.constraints) ? question.constraints : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (EASY_TOPIC_BANNED_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const topicKey = inferEasyTopicKey(question);
  if (topicKey) return true;

  const matched = EASY_TOPIC_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(text)));
  return matched.length > 0;
};

async function generateQuestion(language, level, topic = '') {
  const easyOnly = isEasyLevel(level);
  // Keep prompt unique to encourage varied outputs
  const baseSystem = `You generate a single ORIGINAL coding interview problem. Return STRICT JSON ONLY with keys: title, difficulty, language, problem, input_format, output_format, constraints (array), samples (array of {input,output,explanation}). No prose, no markdown.${easyOnly ? `\nFor difficulty=easy, include an extra string key topic_key. Allowed topic_key values: ${Object.values(EASY_TOPIC_KEYS).join(', ')}. For difficulty=easy, you MUST generate ONLY beginner questions from this catalog: ${EASY_TOPIC_CATALOG.join(', ')}. Do not output any other topic.` : ''}`;
  const topicHint = topic ? `Focus the problem on the user's weak area: ${topic}.` : '';
  const usedTopics = recentQuestionSignatures.slice(-5).join(' || ');

  // Abort slow LLM calls after a short window to keep UX snappy
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), ms)),
  ]);

  const maxAttempts = easyOnly ? 4 : 3;
  const timeoutMs = easyOnly ? 5000 : 2500;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const salt = uuid().slice(0, 6);
    const easyTopic = easyOnly ? EASY_TOPIC_PROMPTS[attempt % EASY_TOPIC_PROMPTS.length] : null;
    const easyUserRule = easyOnly
      ? `STRICT EASY RULES: choose exactly one topic from this catalog and stick to it: ${EASY_TOPIC_CATALOG.join(', ')}. Use topic_key="${easyTopic?.key}". ${easyTopic?.prompt} Avoid arrays/hashmaps/graphs/dp/trees/sliding-window/two-pointers.`
      : '';
    const baseUser = `Create one unique ${level} difficulty coding problem in ${language}. ${topicHint} ${easyUserRule} Avoid repeating these recent problem shapes: ${usedTopics || 'none'}. Include edge cases and clear input/output formats. Salt: ${salt}`;

    try {
      const primaryRaw = await withTimeout(callLLM([
        { role: 'system', content: baseSystem },
        { role: 'user', content: baseUser },
      ]), timeoutMs);

      let parsedRaw = parseJsonLoose(primaryRaw);
      if (!parsedRaw && easyOnly) {
        parsedRaw = await withTimeout(repairQuestionJson(primaryRaw, language, 'easy', easyTopic?.key || ''), 3000);
      }
      if (!parsedRaw && easyOnly) {
        parsedRaw = await withTimeout(regenerateStrictJsonQuestion({
          language,
          level: 'easy',
          easyTopicKey: easyTopic?.key || '',
          topicPrompt: easyTopic?.prompt || '',
        }), 3000);
      }
      if (!parsedRaw && easyOnly) {
        const plainRecovered = buildEasyQuestionFromPlainText(primaryRaw, language, easyTopic?.key || EASY_TOPIC_KEYS.FOR_LOOP);
        if (plainRecovered && isEasyQuestionAllowed(plainRecovered)) {
          plainRecovered.title = allocateUniqueTitle(plainRecovered.title, 'Easy Coding Challenge');
          return plainRecovered;
        }
      }
      if (parsedRaw) {
        const parsed = normalizeGeneratedQuestion(parsedRaw, language, level);
        if (!hasQuestionMinimumShape(parsed)) {
          console.warn('[generateQuestion] parsed JSON missing minimum fields, retrying');
          continue;
        }
        if (easyOnly) {
          parsed.difficulty = 'easy';
          parsed.topic_key = inferEasyTopicKey(parsed) || easyTopic?.key || '';
        }
        parsed.title = allocateUniqueTitle(parsed.title, easyOnly ? 'Easy Coding Challenge' : 'Coding Challenge');
        if (easyOnly && !isEasyQuestionAllowed(parsed)) {
          console.warn('[generateQuestion] easy question rejected (outside allowed catalog), retrying');
          continue;
        }
        if (rememberQuestion(parsed) || easyOnly) {
          return parsed;
        }
      } else if (easyOnly && attempt === 0) {
        console.warn('[generateQuestion] easy output came back non-JSON; applying recovery/fallback flow');
      }
    } catch (err) {
      console.warn('[generateQuestion] LLM call failed/slow, retrying', err?.message || err);
    }
  }

  if (easyOnly) {
    const fallbackTopic = EASY_TOPIC_PROMPTS[Math.floor(Math.random() * EASY_TOPIC_PROMPTS.length)]?.key || EASY_TOPIC_KEYS.FOR_LOOP;
    const fallback = buildEasyFallbackQuestion(language, fallbackTopic);
    fallback.title = allocateUniqueTitle(fallback.title, 'Easy Coding Challenge');
    return fallback;
  }

  // Synthetic structured fallback (fast + varied)
  const uid = uuid().slice(0, 6);
  const fallbackTemplates = [
    {
      title: `Signal Stream Normalizer ${uid}`,
      problem: 'You receive a stream of values that can be integers or lowercase strings. Normalize the stream so that: (1) all integers are kept as-is; (2) strings are converted to their length; (3) any negative integer invalidates the entire batch and returns "INVALID". Output the normalized values in original order unless invalid.',
      input_format: 'First line: n (number of entries). Next n lines: each entry is either an integer or a lowercase string.',
      output_format: 'If a negative integer appears, print INVALID. Otherwise print the normalized values space-separated on one line.',
      constraints: ['1 <= n <= 10^4', 'Strings length 1..20', 'Integers in [-10^9, 10^9]'],
      samples: [
        { input: '5\n7\ncode\n3\napi\n10', output: '7 4 3 3 10', explanation: 'Strings converted to length, all non-negative' },
        { input: '4\n2\nhello\n-5\nworld', output: 'INVALID', explanation: 'Negative integer aborts the batch' },
      ],
    },
    {
      title: `Constraint Router ${uid}`,
      problem: 'You are given a list of tasks, each with a cost and a deadline. Choose the maximum number of tasks you can finish before their deadlines, and output the selected task ids in execution order.',
      input_format: 'First line: n. Next n lines: id cost deadline.',
      output_format: 'Print the selected ids in one valid order.',
      constraints: ['1 <= n <= 2 * 10^4', '1 <= cost, deadline <= 10^9'],
      samples: [
        { input: '3\na 2 4\nb 1 3\nc 2 5', output: 'b a c', explanation: 'One optimal order that fits deadlines' },
      ],
    },
    {
      title: `Edge Case Compass ${uid}`,
      problem: 'Given an array, return the longest contiguous segment where the running sum never becomes negative. If multiple segments tie, return the earliest one.',
      input_format: 'First line: n. Second line: n integers.',
      output_format: 'Print start and end index of the best segment.',
      constraints: ['1 <= n <= 10^5', 'Values in [-10^9, 10^9]'],
      samples: [
        { input: '5\n2 -1 3 -4 5', output: '1 3', explanation: 'Longest valid segment from the start' },
      ],
    },
  ];

  for (const template of fallbackTemplates) {
    const question = {
      title: template.title,
      difficulty: level,
      language,
      problem: template.problem,
      input_format: template.input_format,
      output_format: template.output_format,
      constraints: template.constraints,
      samples: template.samples,
      source: 'synthetic-fallback',
    };
    question.title = allocateUniqueTitle(question.title, 'Coding Challenge');
    if (rememberQuestion(question)) return question;
  }

  const fallbackQuestion = {
    title: `Adaptive Challenge ${uid}`,
    difficulty: level,
    language,
    problem: `Create a solution focused on ${topic || 'the current skill area'} with a fresh twist and unique constraints.`,
    input_format: 'Define the format clearly in your solution.',
    output_format: 'Define the output clearly in your solution.',
    constraints: ['1 <= n <= 10^4'],
    samples: [],
    source: 'synthetic-fallback',
  };
  fallbackQuestion.title = allocateUniqueTitle(fallbackQuestion.title, 'Coding Challenge');
  return fallbackQuestion;
}

app.post('/question', async (req, res) => {
  const { language, level = 'medium', topic = '' } = req.body || {};
  if (!language) return res.status(400).json({ error: 'language is required' });
  try {
    const question = await generateQuestion(language, level, topic);
    console.log(`[question] ok language=${question.language} level=${question.difficulty} title=${question.title || 'untitled'}`);
    return res.json({ question });
  } catch (err) {
    console.error('[question]', err.message || err);
    res.status(500).json({ error: err.message || 'Question generation failed' });
  }
});

app.post('/analyze', async (req, res) => {
  const { language, question, code } = req.body || {};
  if (!language || !question || !code) {
    return res.status(400).json({ error: 'language, question, code are required' });
  }

  const fallbackAnalysis = {
    logic_score: 68,
    syntax_score: 72,
    feedback: 'AI analysis fallback: model response was unavailable or malformed. Review edge cases, add sample-based tests, and re-run submit for a richer analysis.',
    source: 'fallback',
  };

  try {
    if (!llm) throw new Error('LLM not configured (set BYTEZ_API_KEY)');
    const system = 'You are a strict code reviewer. Score logic correctness and syntax/style from 0-100. Return JSON: { logic_score, syntax_score, feedback }.';
    const user = `Problem:\n${question}\n\nLanguage: ${language}\nCandidate solution:\n${code}\n\nScore logic correctness (tests passing likelihood) and syntax/style quality.`;
    const raw = await callLLM([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const parsed = parseJsonLoose(raw);
    if (!parsed) {
      console.warn('[analyze] non-JSON LLM output, serving fallback');
      return res.json(fallbackAnalysis);
    }
    console.log(`[analyze] ok language=${language} logic=${parsed.logic_score} syntax=${parsed.syntax_score}`);
    return res.json(parsed);
  } catch (err) {
    console.error('[analyze]', err.message || err);
    res.json(fallbackAnalysis);
  }
});

// ────────────────────────────────────────────────────────────
// REST endpoints for behavior logging
// ────────────────────────────────────────────────────────────
app.post('/keystroke', async (req, res) => {
  console.log('[POST /keystroke] Received request:', { user_id: req.body?.user_id, action_type: req.body?.action_type });
  const parsed = keystrokeSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[POST /keystroke] Schema validation failed:', parsed.error);
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    console.log('[POST /keystroke] Inserting keystroke data for user:', parsed.data.user_id);
    await insertKeystroke(parsed.data);
    console.log('[POST /keystroke] ✅ Successfully stored keystroke');
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /keystroke] Error:', {
      message: err?.message,
      code: err?.code,
      details: err?.details,
      hint: err?.hint,
    });
    res.status(500).json({ error: 'Failed to store keystroke', details: err?.message });
  }
});

app.post('/emotion', async (req, res) => {
  const parsed = emotionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    await insertEmotion(parsed.data);
    res.json({ ok: true });
  } catch (err) {
    console.error('emotion insert failed', err?.message);
    res.status(500).json({ error: 'Failed to store emotion' });
  }
});

// Behavior blocks — comprehensive behavioral snapshots
async function insertBehaviorBlock(data) {
  if (!supabase) throw new Error('Supabase not configured');
  const payload = {
    user_id: data.user_id,
    test_id: data.test_id || null,
    timestamp: data.timestamp || new Date().toISOString(),
    keystroke_count: Number.isInteger(data.keystroke_count) ? data.keystroke_count : 0,
    backspace_count: Number.isInteger(data.backspace_count) ? data.backspace_count : 0,
    pause_duration_ms: typeof data.pause_duration_ms === 'number' ? data.pause_duration_ms : 0,
    typing_speed_avg: typeof data.typing_speed_avg === 'number' ? data.typing_speed_avg : null,
    paste_detected: typeof data.paste_detected === 'boolean' ? data.paste_detected : false,
    pasted_char_count: Number.isInteger(data.pasted_char_count) ? data.pasted_char_count : 0,
    pasted_line_count: Number.isInteger(data.pasted_line_count) ? data.pasted_line_count : 0,
    idle_ms: typeof data.idle_ms === 'number' ? data.idle_ms : 0,
    hesitation_count: Number.isInteger(data.hesitation_count) ? data.hesitation_count : 0,
    error_count: Number.isInteger(data.error_count) ? data.error_count : 0,
    error_recovery_time_ms: typeof data.error_recovery_time_ms === 'number' ? data.error_recovery_time_ms : null,
    line_rewrites: Number.isInteger(data.line_rewrites) ? data.line_rewrites : 0,
    code_rewrite_count: Number.isInteger(data.code_rewrite_count) ? data.code_rewrite_count : 0,
    deletion_bursts: Number.isInteger(data.deletion_bursts) ? data.deletion_bursts : 0,
    code_snapshot: typeof data.code_snapshot === 'string' ? data.code_snapshot.slice(0, 4000) : null,
    block_duration_ms: typeof data.block_duration_ms === 'number' ? data.block_duration_ms : 0,
    focus_level: typeof data.focus_level === 'number' ? Math.min(100, Math.max(0, data.focus_level)) : null,
    is_completing: typeof data.is_completing === 'boolean' ? data.is_completing : false,
  };

  console.log('[insertBehaviorBlock] Payload:', { user_id: payload.user_id, test_id: payload.test_id, keystroke_count: payload.keystroke_count, is_completing: payload.is_completing });

  const attemptInsert = async (inputPayload) => {
    console.log('[insertBehaviorBlock] Attempting insert with payload keys:', Object.keys(inputPayload));
    const { error } = await supabase.from('behavior_blocks').insert(inputPayload);
    return error;
  };

  let error = await attemptInsert(payload);
  if (!error) {
    console.log('[insertBehaviorBlock] ✅ Insert successful to behavior_blocks');

    // Also store in keystroke_logs for unified data access
    const keystrokeLogPayload = {
      user_id: payload.user_id,
      test_id: payload.test_id,
      timestamp: payload.timestamp,
      action_type: 'behavior_block_summary',
      keystroke_count: payload.keystroke_count,
      backspace_count: payload.backspace_count,
      pause_duration_ms: payload.pause_duration_ms,
      typing_speed_avg: payload.typing_speed_avg,
      paste_detected: payload.paste_detected,
      paste_char_count: payload.pasted_char_count, // MAPPED to keystroke_logs column
      paste_line_count: payload.pasted_line_count, // MAPPED to keystroke_logs column
      idle_time_ms: payload.idle_ms, // MAPPED to keystroke_logs column
      error_count: payload.error_count,
      error_recovery_time_ms: payload.error_recovery_time_ms,
      line_rewrites: payload.line_rewrites,
      code_rewrite_count: payload.code_rewrite_count,
      deletion_bursts: payload.deletion_bursts,
      code_snapshot: payload.code_snapshot,
      block_duration_ms: payload.block_duration_ms,
      focus_level: payload.focus_level,
      is_completing: payload.is_completing,
      hesitation_count: payload.hesitation_count,
    };

    const { error: keystrokeError } = await supabase.from('keystroke_logs').insert(keystrokeLogPayload);
    if (keystrokeError) {
      console.warn('[insertBehaviorBlock] ⚠️ Failed to store in keystroke_logs:', keystrokeError.message);
    } else {
      console.log('[insertBehaviorBlock] ✅ Also stored in keystroke_logs');
    }

    return;
  }

  console.error('[insertBehaviorBlock] Full error details:', { code: error.code, message: error.message, details: error.details });

  // Graceful compatibility for projects where new telemetry columns are not migrated yet.
  if (error.code === 'PGRST204' || error.code === '42703') {
    const minimal = {
      user_id: payload.user_id,
      test_id: payload.test_id,
      timestamp: payload.timestamp,
      keystroke_count: payload.keystroke_count,
      backspace_count: payload.backspace_count,
      pause_duration_ms: payload.pause_duration_ms,
      idle_ms: payload.idle_ms,
      code_snapshot: payload.code_snapshot,
    };
    error = await attemptInsert(minimal);
    if (!error) {
      console.warn('[insertBehaviorBlock] ⚠️ Fell back to minimal schema due to missing columns');

      // Try to store in keystroke_logs with minimal schema too
      const minimalKeystrokeLog = {
        user_id: payload.user_id,
        test_id: payload.test_id,
        timestamp: payload.timestamp,
        action_type: 'behavior_block_summary',
        keystroke_count: payload.keystroke_count,
        pause_duration_ms: payload.pause_duration_ms,
      };
      const { error: keystrokeError } = await supabase.from('keystroke_logs').insert(minimalKeystrokeLog);
      if (!keystrokeError) {
        console.log('[insertBehaviorBlock] ✅ Also stored minimal schema in keystroke_logs');
      }

      return;
    }
  }

  // Graceful fallback: retry with null test_id if FK fails
  if (error.code === '23503') {
    const fallback = { ...payload, test_id: null };
    let retryError = await attemptInsert(fallback);
    if (retryError && (retryError.code === 'PGRST204' || retryError.code === '42703')) {
      retryError = await attemptInsert({
        user_id: fallback.user_id,
        test_id: null,
        timestamp: fallback.timestamp,
        keystroke_count: fallback.keystroke_count,
        backspace_count: fallback.backspace_count,
        pause_duration_ms: fallback.pause_duration_ms,
        idle_ms: fallback.idle_ms,
        code_snapshot: fallback.code_snapshot,
      });
    }
    if (!retryError) {
      // Try to store in keystroke_logs with null test_id
      const fallbackKeystrokeLog = {
        user_id: payload.user_id,
        test_id: null,
        timestamp: payload.timestamp,
        action_type: 'behavior_block_summary',
        keystroke_count: payload.keystroke_count,
        pause_duration_ms: payload.pause_duration_ms,
      };
      const { error: keystrokeError } = await supabase.from('keystroke_logs').insert(fallbackKeystrokeLog);
      if (!keystrokeError) {
        console.log('[insertBehaviorBlock] ✅ Also stored fallback in keystroke_logs');
      }
      return;
    }
    throw retryError;
  }

  throw error;
}

app.post('/behavior-block', async (req, res) => {
  console.log('[POST /behavior-block] Received request:', { user_id: req.body?.user_id, keystroke_count: req.body?.keystroke_count });
  const parsed = behaviorBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[POST /behavior-block] Schema validation failed:', parsed.error);
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    console.log('[POST /behavior-block] Inserting behavior block for user:', parsed.data.user_id);
    await insertBehaviorBlock(parsed.data);
    console.log('[POST /behavior-block] ✅ Successfully stored behavior block');
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /behavior-block]', err?.message);
    res.status(500).json({ error: 'Failed to store behavior block', details: err?.message });
  }
});

app.post('/analysis', async (req, res) => {
  const parsed = baseEventSchema.extend({
    language: z.string().optional(),
    question: z.string().optional(),
    code: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    await ensureSkillTestRecord({
      user_id: parsed.data.user_id,
      test_id: parsed.data.test_id,
      language: parsed.data.language || 'python',
      difficulty: 'medium',
      question: parsed.data.question || 'Assessment session',
      topic: 'general',
    });

    const result = await computeAnalysis(parsed.data);
    if (result.error) return res.status(500).json(result);

    const reportId = parsed.data.test_id || uuid();
    if (supabase) {
      const reportRow = {
        id: reportId,
        user_id: parsed.data.user_id,
        test_id: parsed.data.test_id,
        problem_breakdown_score: result.scores.problemSolving,
        debugging_score: result.scores.debugging,
        focus_score: result.scores.focus,
        planning_score: result.scores.planning,
        flexibility_score: result.scores.adaptability,
        heatmap_data: result.heatmap_data,
        summary: result.summary,
      };

      const { error: reportError } = await supabase.from('reports').upsert(reportRow, { onConflict: 'id' });
      if (reportError) throw reportError;

      const { error: recInsertError } = await supabase.from('recommendations').insert({
        user_id: parsed.data.user_id,
        test_id: parsed.data.test_id,
        weak_areas: Object.entries(result.scores)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3)
          .map(([skill]) => skill),
        recommended_topics: Object.entries(result.scores)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3)
          .map(([skill]) => skill),
        ai_feedback: result.summary,
      });
      if (recInsertError && recInsertError.code !== '23505') {
        console.warn('[analysis] recommendation insert failed:', recInsertError.message);
      }
    }
    res.json({ ok: true, reportId, ...result, insights: result.insights });
  } catch (err) {
    console.error('analysis failed', err?.message);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

// ────────────────────────────────────────────────────────────
// WebSocket pipeline: /stream
// Disabled on Vercel serverless runtime.
// ────────────────────────────────────────────────────────────
if (!IS_VERCEL) {
  attachCollaborationWebSocket({ server, supabase, isAllowedOrigin });
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    ws.on('message', async (msg) => {
      try {
        const payload = JSON.parse(msg.toString());

        if (payload.type === 'behavior-block') {
          // Explicit behavior-block routing
          const parsed = behaviorBlockSchema.safeParse(payload.data);
          if (!parsed.success) {
            console.error('[WS] behavior-block schema validation failed:', parsed.error.issues);
            return;
          }
          try {
            await insertBehaviorBlock(parsed.data);
            console.log('[WS] ✅ behavior-block stored');
          } catch (err) {
            console.error('[WS] behavior-block insert failed:', err?.message);
          }

        } else if (payload.type === 'keystroke-batch') {
          if (!supabase) return;
          const events = Array.isArray(payload?.data?.events) ? payload.data.events : [];
          if (!events.length) return;
          const normalizedEvents = events.map((event) => mapKeystrokePayload(event));
          const { error } = await supabase.from('keystroke_logs').insert(normalizedEvents);
          if (error) {
            console.error('[WS] keystroke-batch insert failed:', error.message);
          }
        } else if (payload.type === 'keystroke') {
          // Check if this is actually a behavior block sent with wrong type
          const data = payload.data;
          if (data && typeof data.keystroke_count !== 'undefined') {
            // Mis-typed behavior block — re-route
            const parsed = behaviorBlockSchema.safeParse(data);
            if (!parsed.success) {
              console.error('[WS] mis-typed behavior-block schema validation failed:', parsed.error.issues);
              return;
            }
            try {
              await insertBehaviorBlock(parsed.data);
              console.log('[WS] ✅ mis-typed behavior-block re-routed and stored');
            } catch (err) {
              console.error('[WS] mis-typed behavior-block insert failed:', err?.message);
            }
          } else {
            // Normal individual keystroke event
            const parsed = keystrokeSchema.safeParse(data);
            if (!parsed.success) {
              console.error('[WS] keystroke schema validation failed:', parsed.error.issues);
              return;
            }
            try {
              await insertKeystroke(parsed.data);
            } catch (err) {
              console.error('[WS] keystroke insert failed:', err?.message);
            }
          }

        } else if (payload.type === 'emotion') {
          const parsed = emotionSchema.safeParse(payload.data);
          if (!parsed.success) {
            console.error('[WS] emotion schema validation failed:', parsed.error.issues);
            return;
          }
          try {
            await insertEmotion(parsed.data);
          } catch (err) {
            console.error('[WS] emotion insert failed:', err?.message);
          }
        }
      } catch (err) {
        console.error('[WS] message handler error:', err.message);
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 SkillDNA Editor API running on http://localhost:${PORT}`);
    console.log(`➡️  WebSocket stream on ws://localhost:${PORT}/stream\n`);
  });
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 1: ENHANCED BEHAVIORAL TRACKING ENGINE
// POST /log-keystroke (alias for /keystroke with enhanced schema)
// ═══════════════════════════════════════════════════════════════

const enhancedKeystrokeSchema = z.object({
  user_id: z.string().min(1),
  test_id: z.string().min(1),
  timestamp: z.string().optional(),
  typing_speed: z.number().nonnegative().optional(),
  pause_duration: z.number().nonnegative().default(0),
  backspace_count: z.number().nonnegative().optional().default(0),
  cursor_position: z.number().int().nullable().optional(),
  line_number: z.number().int().nullable().optional(),
  code_snapshot: z.string().max(5000).optional(),
  key_pressed: z.any().optional(),
  action_type: z.string().optional(),
  code_length: z.number().int().nonnegative().optional(),
  word_count: z.number().int().nonnegative().optional(),
  line_time_ms: z.number().nonnegative().optional(),
  idle_ms: z.number().nonnegative().optional(),
  error_count: z.number().int().nonnegative().optional(),
  paste_detected: z.boolean().optional(),
  pasted_char_count: z.number().int().nonnegative().optional(),
  pasted_line_count: z.number().int().nonnegative().optional(),
  sudden_code_jump: z.boolean().optional(),
});

app.post('/log-keystroke', async (req, res) => {
  const parsed = enhancedKeystrokeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    await insertKeystroke(parsed.data);
    res.json({ ok: true });
  } catch (err) {
    console.error('[log-keystroke]', err?.message);
    res.status(500).json({ error: 'Failed to log keystroke' });
  }
});

// Batch keystroke endpoint for performance
app.post('/log-keystrokes-batch', async (req, res) => {
  const { events } = req.body || {};
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events array required' });
  }
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const payload = events.map((event) => mapKeystrokePayload(event));
    let { error } = await supabase.from('keystroke_logs').insert(payload);
    if (error && (error.code === 'PGRST204' || error.code === '42703')) {
      const minimal = payload.map((row) => ({
        user_id: row.user_id,
        test_id: row.test_id,
        timestamp: row.timestamp,
        typing_speed: row.typing_speed,
        pause_duration: row.pause_duration,
        backspace_count: row.backspace_count,
        cursor_position: row.cursor_position,
        code_snapshot: row.code_snapshot,
      }));
      ({ error } = await supabase.from('keystroke_logs').insert(minimal));
    }
    if (error && error.code !== '23503') throw error;
    res.json({ ok: true, count: payload.length });
  } catch (err) {
    console.error('[log-keystrokes-batch]', err?.message);
    res.status(500).json({ error: 'Batch insert failed' });
  }
});

// Backward-compatible aliases used by frontend retry queue utilities.
app.post('/api/keystroke-log', async (req, res) => {
  const parsed = enhancedKeystrokeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    await insertKeystroke(parsed.data);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/keystroke-log]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to log keystroke' });
  }
});

app.post('/api/keystroke-logs', async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!events.length) return res.status(400).json({ error: 'events[] required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase env missing' });

  try {
    const normalizedEvents = events.map((event) => mapKeystrokePayload(event));
    const { error } = await supabase.from('keystroke_logs').insert(normalizedEvents);
    if (error) throw error;
    res.json({ ok: true, inserted: normalizedEvents.length });
  } catch (err) {
    console.error('[api/keystroke-logs]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to store keystroke batch' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: COGNITIVE PROFILING ENGINE
// POST /generate-report — full cognitive analysis + store in reports
// ═══════════════════════════════════════════════════════════════

const clampScore = (value) => Math.round(clamp(value, 20, 98));

async function computeDeepCognitiveProfile(userId, testId) {
  if (!supabase) throw new Error('Supabase not configured');

  const [{ data: keystrokes }, { data: emotions }, { data: submissions }] = await Promise.all([
    supabase.from('keystroke_logs')
      .select(`
        timestamp, typing_speed, typing_speed_avg, pause_duration_ms,
        idle_ms, idle_time_ms, backspace_count, deletion_bursts, line_rewrites,
        code_rewrite_count, error_recovery_time_ms, hesitation_count,
        focus_level, is_paste_event, paste_detected, pasted_line_count,
        pasted_char_count, paste_line_count, paste_char_count,
        burst_insert_detected, sudden_code_jump, line_number, prev_line_number,
        action_type, error_count, block_duration_ms, code_length, keystroke_count, is_completing
      `)
      .eq('user_id', userId)
      .eq('test_id', testId)
      .order('timestamp', { ascending: true }),
    supabase.from('emotion_logs')
      .select('timestamp, emotion, confidence, gaze_state')
      .eq('user_id', userId)
      .eq('test_id', testId)
      .order('timestamp', { ascending: true }),
    supabase.from('submissions')
      .select('passed, execution_time, created_at, language')
      .eq('user_id', userId)
      .eq('test_id', testId)
      .order('created_at', { ascending: true }),
  ]);

  const rows = keystrokes || [];
  const emotionRows = emotions || [];
  const submissionRows = submissions || [];

  const totalRows = Math.max(rows.length, 1);
  const firstTs = rows[0]?.timestamp ? new Date(rows[0].timestamp).getTime() : Date.now();
  const lastTs = rows[rows.length - 1]?.timestamp ? new Date(rows[rows.length - 1].timestamp).getTime() : firstTs;
  const totalSessionMs = Math.max(1, lastTs - firstTs);

  let totalTypingSpeed = 0;
  let speedSampleCount = 0;
  let totalPauseMs = 0;
  let pauseInPlanningWindow = 0;
  let planningWindowCount = 0;
  let totalIdleMs = 0;
  let totalBackspaceCount = 0;
  let deletionBurstsTotal = 0;
  let hesitationCountTotal = 0;
  let totalFocusLevel = 0;
  let focusCount = 0;
  let codeRewriteCount = 0;
  let suddenCodeJumpCount = 0;
  let pasteDetectedCount = 0;
  let burstInsertDetectedCount = 0;
  let idlePauseCount = 0;
  let blockDurationTotal = 0;
  let blockDurationCount = 0;
  let errorRecoveryTotal = 0;
  let errorRecoveryCount = 0;
  let maxKeystrokeCount = 0;
  let typingSpeedVarianceAcc = 0;
  let typingSpeedMean = 0;
  let typingSpeedM2 = 0;
  let typingSpeedN = 0;
  let sameLineStuckCount = 0;
  let sameLineRunLength = 0;
  let prevLine = null;
  let deletionBurstImproved = false;
  let pendingDeletionErrorCount = null;
  let lastErrorCount = null;

  const lineAgg = new Map();
  const lineRewriteAgg = new Map();

  for (const row of rows) {
    const ts = row.timestamp ? new Date(row.timestamp).getTime() : firstTs;
    const pauseMs = Number(row.pause_duration_ms || row.pause_duration || 0);
    const idleMs = Number(
      typeof row.idle_ms === 'number'
        ? row.idle_ms
        : (typeof row.idle_time_ms === 'number' ? row.idle_time_ms : 0)
    );
    const typingSpeed = Number(row.typing_speed || 0);
    const backspaceCount = Number(row.backspace_count || 0);
    const deletionBursts = Number(row.deletion_bursts || 0);
    const hesitationCount = Number(row.hesitation_count || 0);
    const lineRewrites = Number(row.line_rewrites || 0);
    const lineNumber = Number.isInteger(row.line_number) ? row.line_number : null;
    const errorCount = Number.isInteger(row.error_count) ? row.error_count : null;

    totalPauseMs += pauseMs;
    if (pauseMs >= 2000) idlePauseCount += 1;
    totalIdleMs += idleMs;
    totalBackspaceCount += backspaceCount;
    deletionBurstsTotal += deletionBursts;
    hesitationCountTotal += hesitationCount;
    codeRewriteCount += Number(row.code_rewrite_count || 0);
    suddenCodeJumpCount += row.sudden_code_jump ? 1 : 0;
    pasteDetectedCount += (row.paste_detected || row.is_paste_event) ? 1 : 0;
    burstInsertDetectedCount += row.burst_insert_detected ? 1 : 0;
    maxKeystrokeCount = Math.max(maxKeystrokeCount, Number(row.keystroke_count || 0));

    if (typingSpeed > 0) {
      totalTypingSpeed += typingSpeed;
      speedSampleCount += 1;
      typingSpeedN += 1;
      const delta = typingSpeed - typingSpeedMean;
      typingSpeedMean += delta / typingSpeedN;
      const delta2 = typingSpeed - typingSpeedMean;
      typingSpeedM2 += delta * delta2;
    }

    if (typeof row.focus_level === 'number') {
      totalFocusLevel += row.focus_level;
      focusCount += 1;
    }

    if (typeof row.block_duration_ms === 'number' && row.block_duration_ms > 0) {
      blockDurationTotal += row.block_duration_ms;
      blockDurationCount += 1;
    }

    if (typeof row.error_recovery_time_ms === 'number' && row.error_recovery_time_ms > 0) {
      errorRecoveryTotal += row.error_recovery_time_ms;
      errorRecoveryCount += 1;
    }

    if (ts - firstTs <= 90000) {
      pauseInPlanningWindow += pauseMs;
      planningWindowCount += 1;
    }

    if (lineNumber != null) {
      const existing = lineAgg.get(lineNumber) || { backspace: 0, hesitation: 0, rewrites: 0 };
      existing.backspace += backspaceCount;
      existing.hesitation += hesitationCount;
      existing.rewrites += lineRewrites;
      lineAgg.set(lineNumber, existing);
      lineRewriteAgg.set(lineNumber, (lineRewriteAgg.get(lineNumber) || 0) + lineRewrites);

      if (prevLine === lineNumber) {
        sameLineRunLength += 1;
        if (sameLineRunLength === 16) sameLineStuckCount += 1;
      } else {
        sameLineRunLength = 1;
        prevLine = lineNumber;
      }
    }

    if (deletionBursts > 0 && errorCount != null) {
      pendingDeletionErrorCount = errorCount;
    }
    if (pendingDeletionErrorCount != null && errorCount != null && errorCount < pendingDeletionErrorCount) {
      deletionBurstImproved = true;
      pendingDeletionErrorCount = null;
    }

    if (lastErrorCount != null && errorCount != null && errorCount < lastErrorCount) {
      deletionBurstImproved = deletionBurstImproved || deletionBurstsTotal > 0;
    }
    lastErrorCount = errorCount ?? lastErrorCount;
  }

  typingSpeedVarianceAcc = typingSpeedN > 1 ? (typingSpeedM2 / (typingSpeedN - 1)) : 0;
  const typingSpeedVariance = Math.sqrt(typingSpeedVarianceAcc);

  const avgTypingSpeed = speedSampleCount ? totalTypingSpeed / speedSampleCount : 0;
  const avgPauseMs = planningWindowCount ? (pauseInPlanningWindow / planningWindowCount) : 0;
  const avgFocusLevel = focusCount ? (totalFocusLevel / focusCount) : 0;
  const avgBlockDurationMs = blockDurationCount ? (blockDurationTotal / blockDurationCount) : 0;
  const avgErrorRecoveryMs = errorRecoveryCount ? (errorRecoveryTotal / errorRecoveryCount) : null;

  const passedSubmissions = submissionRows.filter((s) => s.passed).length;
  const totalSubmissions = Math.max(submissionRows.length, 1);
  const planningPhaseDetected = avgPauseMs > 1800;

  const emotionCounts = emotionRows.reduce((acc, row) => {
    const key = String(row.emotion || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dominantEmotionEntry = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0] || ['unknown', 0];
  const dominantEmotion = dominantEmotionEntry[0];
  const dominantEmotionPct = emotionRows.length
    ? Number(((dominantEmotionEntry[1] / emotionRows.length) * 100).toFixed(1))
    : 0;

  const totalKeystrokes = Math.max(maxKeystrokeCount, rows.length);
  const activeCodingMs = Math.max(0, totalSessionMs - totalIdleMs);

  const problemBreakdownScore = clampScore(
    50
    + (passedSubmissions / totalSubmissions) * 25
    + (planningPhaseDetected ? 15 : 0)
    + clamp((avgTypingSpeed / 8) * 10, 0, 10)
    - (suddenCodeJumpCount * 3)
    - (codeRewriteCount > 3 ? 10 : 0)
  );

  const debuggingScore = clampScore(
    85
    - (deletionBurstsTotal * 2.5)
    - ((totalBackspaceCount / Math.max(totalKeystrokes, 1)) * 40)
    + ((avgErrorRecoveryMs != null && avgErrorRecoveryMs < 8000) ? 10 : 0)
    + ((codeRewriteCount >= 1 && codeRewriteCount <= 3) ? 8 : 0)
    - (codeRewriteCount > 5 ? 15 : 0)
  );

  const activityRatio = clamp(activeCodingMs / Math.max(1, totalSessionMs), 0, 1);
  const explicitFocusPct = clamp(avgFocusLevel <= 1 ? (avgFocusLevel * 100) : avgFocusLevel, 0, 100);
  const behavioralPenalty = clamp(
    (hesitationCountTotal * 1.8) +
    (idlePauseCount * 2.5) +
    (deletionBurstsTotal * 1.6) +
    ((emotionCounts.distracted || 0) * 8) +
    ((emotionCounts.bored || 0) * 4),
    0,
    65
  );
  const focusComposite =
    (explicitFocusPct * 0.55) +
    (activityRatio * 100 * 0.30) +
    ((100 - behavioralPenalty) * 0.15);
  const focusScore = clampScore(focusComposite);

  const planningScore = clampScore(
    40
    + (planningPhaseDetected ? 25 : 0)
    + (suddenCodeJumpCount === 0 ? 15 : 0)
    - (codeRewriteCount * 4)
    + (avgBlockDurationMs > 5000 ? 10 : 0)
    + (pasteDetectedCount === 0 ? 10 : 0)
  );

  const flexibilityScore = clampScore(
    70
    + ((codeRewriteCount >= 1 && codeRewriteCount <= 4) ? 15 : 0)
    - ((emotionCounts.frustrated || 0) * 8)
    - ((emotionCounts.confused || 0) * 5)
    + ((deletionBurstsTotal > 0 && deletionBurstImproved) ? 12 : 0)
    - (sameLineStuckCount * 3)
  );

  const integrityScore = clampScore(
    100
    - (pasteDetectedCount * 15)
    - (burstInsertDetectedCount * 20)
    - (suddenCodeJumpCount > 5 ? 25 : 0)
    + (typingSpeedVariance < 3 ? 0 : 5)
  );

  const heatmap_data = Array.from(lineAgg.entries()).map(([line, agg]) => {
    const weight = Number((agg.backspace + agg.hesitation + agg.rewrites).toFixed(3));
    return { line: Number(line), weight, type: weight >= 4 ? 'hot' : 'cold' };
  });

  const mostRewrittenLine = Array.from(lineRewriteAgg.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const avgHesitationMs = hesitationCountTotal ? (totalPauseMs / hesitationCountTotal) : 0;

  const summary = [
    `Problem:${problemBreakdownScore}`,
    `Debug:${debuggingScore}`,
    `Focus:${focusScore}`,
    `Plan:${planningScore}`,
    `Flex:${flexibilityScore}`,
    `Integrity:${integrityScore}`,
    `Planning phase:${planningPhaseDetected ? 'detected' : 'not detected'}`,
    `Pastes:${pasteDetectedCount}`,
    `Burst inserts:${burstInsertDetectedCount}`,
    `Most struggled line:${mostRewrittenLine[0] ?? 'NA'} (${mostRewrittenLine[1]} rewrites)`,
    `Dominant emotion:${dominantEmotion} (${dominantEmotionPct}%)`,
  ].join(' | ');

  return {
    scores: {
      problem_breakdown_score: problemBreakdownScore,
      debugging_score: debuggingScore,
      focus_score: focusScore,
      planning_score: planningScore,
      flexibility_score: flexibilityScore,
      integrity_score: integrityScore,
    },
    heatmap_data,
    summary,
    metrics: {
      total_session_ms: totalSessionMs,
      active_coding_ms: activeCodingMs,
      total_idle_ms: totalIdleMs,
      avg_typing_speed: Number(avgTypingSpeed.toFixed(3)),
      peak_typing_speed: Number(Math.max(...rows.map((r) => Number(r.typing_speed || 0)), 0).toFixed(3)),
      typing_speed_variance: Number(typingSpeedVariance.toFixed(3)),
      hesitation_count_total: hesitationCountTotal,
      avg_hesitation_ms: Number(avgHesitationMs.toFixed(2)),
      deletion_bursts_total: deletionBurstsTotal,
      total_backspace_count: totalBackspaceCount,
      code_rewrite_count: codeRewriteCount,
      planning_phase_detected: planningPhaseDetected,
      paste_detected_count: pasteDetectedCount,
      burst_insert_detected_count: burstInsertDetectedCount,
      sudden_code_jump_count: suddenCodeJumpCount,
      most_rewritten_line: mostRewrittenLine[0],
      most_rewritten_line_count: mostRewrittenLine[1],
      avg_focus_level: Number(avgFocusLevel.toFixed(4)),
      avg_error_recovery_time_ms: avgErrorRecoveryMs ? Number(avgErrorRecoveryMs.toFixed(2)) : null,
      block_duration_ms_avg: Number(avgBlockDurationMs.toFixed(2)),
      same_line_stuck_count: sameLineStuckCount,
      dominant_emotion: dominantEmotion,
      dominant_emotion_pct: dominantEmotionPct,
      passed_submissions: passedSubmissions,
      total_submissions: totalSubmissions,
      submission_result: submissionRows.length && submissionRows[submissionRows.length - 1].passed ? 'passed' : 'failed',
      last_execution_time_ms: submissionRows[submissionRows.length - 1]?.execution_time || null,
      language: submissionRows[submissionRows.length - 1]?.language || null,
      has_integrity_flags: pasteDetectedCount > 0 || burstInsertDetectedCount > 0,
      total_pasted_chars: rows.reduce((acc, row) => acc + Number(row.pasted_char_count || row.paste_char_count || 0), 0),
      total_pasted_lines: rows.reduce((acc, row) => acc + Number(row.pasted_line_count || row.paste_line_count || 0), 0),
      raw_rows: rows.length,
      emotion_rows: emotionRows.length,
    },
  };
}

app.post('/generate-report', async (req, res) => {
  const { user_id, test_id } = req.body || {};
  if (!user_id || !test_id) return res.status(400).json({ error: 'user_id and test_id required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    await ensureSkillTestRecord({
      user_id,
      test_id,
      language: 'python',
      difficulty: 'medium',
      question: 'Assessment session',
      topic: 'general',
    });

    const profile = await computeDeepCognitiveProfile(user_id, test_id);
    const reportRow = {
      user_id,
      test_id,
      problem_breakdown_score: profile.scores.problem_breakdown_score,
      debugging_score: profile.scores.debugging_score,
      focus_score: profile.scores.focus_score,
      planning_score: profile.scores.planning_score,
      flexibility_score: profile.scores.flexibility_score,
      heatmap_data: profile.heatmap_data,
      summary: profile.summary,
    };

    const persistedReportId = await upsertReportWithFallback(reportRow);

    res.json({
      ok: true,
      reportId: persistedReportId || test_id,
      scores: {
        problemSolving: profile.scores.problem_breakdown_score,
        debugging: profile.scores.debugging_score,
        focus: profile.scores.focus_score,
        planning: profile.scores.planning_score,
        adaptability: profile.scores.flexibility_score,
        integrity: profile.scores.integrity_score,
      },
      deep_profile: profile,
      heatmap_data: profile.heatmap_data,
      summary: profile.summary,
    });
  } catch (err) {
    console.error('[generate-report]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to generate report' });
  }
});

app.get('/behavioral-timeline', async (req, res) => {
  const user_id = String(req.query.user_id || req.headers['x-user-id'] || '');
  const test_id = String(req.query.test_id || '');
  if (!user_id || !test_id) return res.status(400).json({ error: 'user_id and test_id are required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const { data, error } = await supabase
      .from('keystroke_logs')
      .select(`
        timestamp, typing_speed, typing_speed_avg, pause_duration_ms,
        idle_ms, idle_time_ms, backspace_count, deletion_bursts, line_rewrites,
        code_rewrite_count, hesitation_count, focus_level, is_paste_event,
        paste_detected, pasted_line_count, pasted_char_count, paste_line_count,
        paste_char_count, burst_insert_detected, sudden_code_jump, line_number,
        prev_line_number, action_type, code_length, keystroke_count, error_count
      `)
      .eq('user_id', user_id)
      .eq('test_id', test_id)
      .order('timestamp', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, rows: data || [] });
  } catch (err) {
    console.error('[behavioral-timeline]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to fetch timeline' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 3: SMART REPORT — GET /user-report/:test_id
// ═══════════════════════════════════════════════════════════════

app.get('/user-report/:test_id', async (req, res) => {
  const { test_id } = req.params;
  const user_id = req.headers['x-user-id'];
  if (!user_id) return res.status(401).json({ error: 'x-user-id header required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const { data: report, error } = await supabase
      .from('reports')
      .select('*, skill_tests(language, difficulty, question, topic)')
      .eq('user_id', user_id)
      .eq('test_id', test_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const { data: recs } = await supabase
      .from('recommendations')
      .select('*')
      .eq('user_id', user_id)
      .eq('test_id', test_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    res.json({ report, recommendations: recs || null });
  } catch (err) {
    console.error('[user-report]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to fetch report' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 4: RECRUITER / HIRING MODE
// GET /recruiter-dashboard
// ═══════════════════════════════════════════════════════════════

function computeHiringScore(report) {
  const scores = [
    report.problem_breakdown_score || 0,
    report.debugging_score || 0,
    report.focus_score || 0,
    report.planning_score || 0,
    report.flexibility_score || 0,
  ];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg);
}

function getHiringRecommendation(score) {
  if (score >= 78) return { label: 'Hire', color: 'green', reason: 'Strong across all cognitive dimensions.' };
  if (score >= 58) return { label: 'Train', color: 'amber', reason: 'Solid potential, needs focused development.' };
  return { label: 'Reject', color: 'red', reason: 'Significant gaps in key areas.' };
}

const fetchSubmissionStatsByTestIds = async (testIds = []) => {
  const submissionStats = {};
  if (!testIds.length) return submissionStats;

  const { data: subs } = await supabase
    .from('submissions')
    .select('test_id, passed, execution_time')
    .in('test_id', testIds);

  (subs || []).forEach((s) => {
    if (!submissionStats[s.test_id]) submissionStats[s.test_id] = { total: 0, passed: 0, avgTime: 0 };
    submissionStats[s.test_id].total += 1;
    if (s.passed) submissionStats[s.test_id].passed += 1;
    submissionStats[s.test_id].avgTime += Number(s.execution_time || 0);
  });

  Object.values(submissionStats).forEach((stat) => {
    stat.avgTime = stat.total ? stat.avgTime / stat.total : 0;
    stat.successRate = stat.total ? (stat.passed / stat.total) * 100 : 0;
  });

  return submissionStats;
};

const mapReportToCandidate = (report, submissionStats = {}) => {
  const cogScore = computeHiringScore(report);
  const subs = submissionStats[report.test_id] || { total: 0, passed: 0, successRate: 0, avgTime: 0 };
  const hiringScore = Math.round(cogScore * 0.6 + subs.successRate * 0.4);
  const recommendation = getHiringRecommendation(hiringScore);

  return {
    reportId: report.id,
    userId: report.user_id,
    testId: report.test_id,
    name: report.users?.name || 'Anonymous',
    email: report.users?.email || '',
    profile: {
      headline: report.users?.headline || '',
      location: report.users?.location || '',
      about: report.users?.about || '',
      github: report.users?.github_url || '',
      linkedin: report.users?.linkedin_url || '',
      category: report.users?.category || '',
    },
    language: report.skill_tests?.language || 'unknown',
    difficulty: report.skill_tests?.difficulty || 'medium',
    topic: report.skill_tests?.topic || '',
    createdAt: report.created_at,
    cognitiveScore: cogScore,
    submissionSuccessRate: Math.round(subs.successRate),
    totalSubmissions: subs.total,
    avgExecutionTime: Math.round(subs.avgTime * 1000) / 1000,
    hiringScore,
    recommendation,
    scores: {
      problemBreakdown: report.problem_breakdown_score || 0,
      debugging: report.debugging_score || 0,
      focus: report.focus_score || 0,
      planning: report.planning_score || 0,
      flexibility: report.flexibility_score || 0,
    },
    summary: report.summary || '',
  };
};

const groupCandidatesByUser = (candidateAttempts = []) => {
  const grouped = new Map();

  candidateAttempts.forEach((attempt) => {
    const key = attempt.userId || attempt.email || attempt.reportId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...attempt,
        attempts: [attempt],
        attemptsCount: 1,
        languages: [attempt.language].filter(Boolean),
      });
      return;
    }

    const current = grouped.get(key);
    current.attempts.push(attempt);
    current.attemptsCount = current.attempts.length;

    if (attempt.language && !current.languages.includes(attempt.language)) {
      current.languages.push(attempt.language);
    }

    // Keep the highest-scoring attempt for headline metrics + recommendation badge.
    if (attempt.hiringScore > current.hiringScore) {
      current.reportId = attempt.reportId;
      current.testId = attempt.testId;
      current.language = attempt.language;
      current.difficulty = attempt.difficulty;
      current.topic = attempt.topic;
      current.cognitiveScore = attempt.cognitiveScore;
      current.submissionSuccessRate = attempt.submissionSuccessRate;
      current.totalSubmissions = attempt.totalSubmissions;
      current.avgExecutionTime = attempt.avgExecutionTime;
      current.hiringScore = attempt.hiringScore;
      current.recommendation = attempt.recommendation;
      current.scores = attempt.scores;
      current.summary = attempt.summary;
      current.createdAt = attempt.createdAt;
    } else if (new Date(attempt.createdAt).getTime() > new Date(current.createdAt).getTime()) {
      // Preserve latest activity timestamp for non-max attempts.
      current.createdAt = attempt.createdAt;
    }
  });

  return [...grouped.values()].map((student) => ({
    ...student,
    attempts: (student.attempts || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  }));
};

app.get('/recruiter-dashboard', async (req, res) => {
  const user_id = req.headers['x-user-id'];
  const userRole = String(req.headers['x-user-role'] || 'student').toLowerCase();
  const recruiterAccess = userRole === 'recruiter';
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    let query = supabase
      .from('reports')
      .select('id, user_id, test_id, created_at, problem_breakdown_score, debugging_score, focus_score, planning_score, flexibility_score, summary, users(name, email, headline, location, about, github_url, linkedin_url, category), skill_tests(language, difficulty, topic)')
      .order('created_at', { ascending: false })
      .limit(100);

    // For students, filter to their own records. Recruiters can view all.
    if (!recruiterAccess && user_id) query = query.eq('user_id', user_id);

    const { data: reports, error } = await query;
    if (error) throw error;

    const testIds = [...new Set((reports || []).map(r => r.test_id).filter(Boolean))];
    const submissionStats = await fetchSubmissionStatsByTestIds(testIds);
    const candidateAttempts = (reports || [])
      .map((r) => mapReportToCandidate(r, submissionStats))
      .sort((a, b) => b.hiringScore - a.hiringScore);

    const candidates = groupCandidatesByUser(candidateAttempts).sort((a, b) => b.hiringScore - a.hiringScore);

    res.json({ ok: true, count: candidates.length, candidates });
  } catch (err) {
    console.error('[recruiter-dashboard]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to load dashboard' });
  }
});

app.get('/recruiter-report/:reportId', async (req, res) => {
  const userRole = String(req.headers['x-user-role'] || 'student').toLowerCase();
  if (userRole !== 'recruiter') return res.status(403).json({ error: 'Recruiter access required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  const { reportId } = req.params;

  try {
    const { data: report, error } = await supabase
      .from('reports')
      .select('id, user_id, test_id, created_at, problem_breakdown_score, debugging_score, focus_score, planning_score, flexibility_score, summary, users(name, email, headline, location, about, github_url, linkedin_url, category), skill_tests(language, difficulty, topic)')
      .eq('id', reportId)
      .maybeSingle();

    if (error) throw error;
    if (!report) return res.status(404).json({ error: 'Candidate report not found' });

    const submissionStats = await fetchSubmissionStatsByTestIds([report.test_id].filter(Boolean));
    const candidate = mapReportToCandidate(report, submissionStats);

    const { data: candidateHistory } = await supabase
      .from('reports')
      .select('id, created_at, problem_breakdown_score, debugging_score, focus_score, planning_score, flexibility_score')
      .eq('user_id', report.user_id)
      .order('created_at', { ascending: false })
      .limit(8);

    res.json({
      ok: true,
      candidate,
      history: (candidateHistory || []).map((r) => ({
        reportId: r.id,
        createdAt: r.created_at,
        cognitiveScore: computeHiringScore(r),
      })),
    });
  } catch (err) {
    console.error('[recruiter-report]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to load recruiter report' });
  }
});

app.get('/recruiter-analysis', async (req, res) => {
  const userRole = String(req.headers['x-user-role'] || 'student').toLowerCase();
  if (userRole !== 'recruiter') return res.status(403).json({ error: 'Recruiter access required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const { data: reports, error } = await supabase
      .from('reports')
      .select('id, user_id, test_id, created_at, problem_breakdown_score, debugging_score, focus_score, planning_score, flexibility_score, summary, users(name, email, headline, location, about, github_url, linkedin_url, category), skill_tests(language, difficulty, topic)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const testIds = [...new Set((reports || []).map((r) => r.test_id).filter(Boolean))];
    const submissionStats = await fetchSubmissionStatsByTestIds(testIds);
    const candidates = (reports || [])
      .map((r) => mapReportToCandidate(r, submissionStats))
      .sort((a, b) => b.hiringScore - a.hiringScore);

    const hireReady = candidates.filter((c) => c.recommendation.label === 'Hire');
    const trainable = candidates.filter((c) => c.recommendation.label === 'Train');
    const risky = candidates.filter((c) => c.recommendation.label === 'Reject');

    const avgHiringScore = candidates.length
      ? Math.round(candidates.reduce((sum, c) => sum + c.hiringScore, 0) / candidates.length)
      : 0;

    const byLanguage = candidates.reduce((acc, c) => {
      const key = c.language || 'unknown';
      if (!acc[key]) acc[key] = { language: key, total: 0, hireReady: 0 };
      acc[key].total += 1;
      if (c.recommendation.label === 'Hire') acc[key].hireReady += 1;
      return acc;
    }, {});

    res.json({
      ok: true,
      summary: {
        totalCandidates: candidates.length,
        avgHiringScore,
        hireReady: hireReady.length,
        trainable: trainable.length,
        risky: risky.length,
      },
      topHireReady: hireReady.slice(0, 10),
      byLanguage: Object.values(byLanguage),
    });
  } catch (err) {
    console.error('[recruiter-analysis]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to load recruiter analysis' });
  }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 5: AI FEEDBACK & RECOMMENDATION ENGINE
// POST /generate-recommendations
// ═══════════════════════════════════════════════════════════════

async function generateAIRecommendations(ctx) {
  const { scores, submissionErrors, language, topic, difficulty,
    totalAssessments, trend, behavioral, submission, summaryLine } = ctx;

  const weakAreas = Object.entries(scores)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([skill, score]) => ({ skill, score: Number(score) }));

  const bestSkill = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])[0];

  const trendLines = trend
    ? Object.entries(trend)
      .map(([skill, delta]) => `${skill}: ${delta >= 0 ? '+' : ''}${delta} vs last session`)
      .join(', ')
    : 'First assessment — no trend data yet';

  const behavioralSummary = behavioral
    ? `Duration: ${behavioral.durationLabel || 'unknown'}, ` +
    `Typing speed: ${behavioral.avgTypingSpeed} chars/s, ` +
    `Typed chars: ${behavioral.totalTypedChars ?? '?'}, ` +
    `Backspaces: ${behavioral.totalBackspaces}, ` +
    `Deletion bursts: ${behavioral.totalDeletionBursts}, ` +
    `Hesitations: ${behavioral.totalHesitations}, ` +
    `Avg focus: ${behavioral.avgFocusPercent}%, ` +
    `Code rewrites: ${behavioral.totalRewrites}`
    : 'No behavioral telemetry available';

  const systemPrompt = `You are a senior engineering mentor and cognitive performance analyst.
You analyze real developer behavioral data from coding assessments and provide
precise, data-driven, genuinely personalized feedback.
RULES:
- Never say "Great job" or "You did well"
- Every sentence must reference a real number from the data provided
- Be specific about what the developer did, not generic advice
- Sound like a mentor who has reviewed this specific session, not a template
- Return ONLY valid JSON, no prose outside the JSON object`;

  const userPrompt = `Developer Assessment Analysis:

Language: ${language} | Topic: ${topic} | Difficulty: ${difficulty}
Total assessments completed: ${totalAssessments}

COGNITIVE SCORES (0-100):
${weakAreas.map(w => `  ${w.skill}: ${w.score} (WEAK)`).join('\n')}
  ${bestSkill[0]}: ${bestSkill[1]} (STRONGEST)

SCORE TREND vs previous session:
${trendLines}

BEHAVIORAL TELEMETRY:
${behavioralSummary}

SUBMISSION RESULTS:
  Passed: ${submission.passed}/${submission.totalAttempts}
  Failed: ${submission.failed}
  Errors: ${submissionErrors.length > 0 ? submissionErrors.join(' | ') : 'None'}

SESSION SUMMARY FROM SYSTEM:
${summaryLine}

Based on ALL of the above real data, generate:
{
  "headline": "One punchy sentence (max 15 words) describing this specific developer based on their actual numbers",
  "behavioral_story": "2-3 sentences describing what literally happened in this session. Reference specific numbers: typing speed, deletion bursts, hesitations, rewrites. No fluff.",
  "weak_areas": ["skill1", "skill2", "skill3"],
  "strength_note": "One sentence about their best skill with evidence from the data",
  "growth_areas": [
    {
      "skill": "skillName",
      "score": number,
      "why_weak": "One specific sentence referencing behavioral data that caused this score",
      "fix": "One concrete actionable technique specific to this score and behavior",
      "practice_topic": "Exact algorithm/concept to practice"
    }
  ],
  "recommended_topics": ["topic1", "topic2", "topic3", "topic4", "topic5", "topic6"],
  "suggested_questions": [
    { "title": "...", "difficulty": "easy|medium|hard", "tags": ["..."], "targets_skill": "skillName" }
  ],
  "personalized_feedback": "3-4 sentences. Every sentence must include a real number from the data above. This is the main narrative feedback.",
  "study_plan": [
    "Week 1: ...",
    "Week 2: ...",
    "Week 3: ...",
    "Week 4: ..."
  ]
}`;

  if (llm) {
    try {
      const raw = await callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      const parsed = parseJsonLoose(raw);
      if (parsed && parsed.headline) return parsed;
    } catch (err) {
      console.warn('[generateAIRecommendations] LLM failed:', err?.message);
    }
  }

  // Rich rule-based fallback (uses real numbers)
  const w0 = weakAreas[0];
  const w1 = weakAreas[1];

  const topicFallbackMap = {
    problemSolving: ['Dynamic Programming', 'Greedy Algorithms', 'Divide & Conquer', 'BFS/DFS'],
    debugging: ['Test-Driven Development', 'Error Handling Patterns', 'Edge Case Analysis'],
    focus: ['Time-Boxing', 'Pomodoro for Coding', 'Incremental Problem Solving'],
    planning: ['Pseudocode First', 'Complexity Analysis', 'Algorithm Design Patterns'],
    flexibility: ['Refactoring Techniques', 'Multiple Solution Approaches', 'Adaptive Algorithms'],
  };

  const questionFallbackMap = {
    problemSolving: [
      { title: 'Coin Change', difficulty: 'medium', tags: ['DP'], targets_skill: 'problemSolving' },
      { title: 'Longest Common Subsequence', difficulty: 'medium', tags: ['DP', 'strings'], targets_skill: 'problemSolving' },
    ],
    debugging: [
      { title: 'Find the Duplicate', difficulty: 'easy', tags: ['arrays', 'debugging'], targets_skill: 'debugging' },
      { title: 'Validate BST', difficulty: 'medium', tags: ['trees', 'validation'], targets_skill: 'debugging' },
    ],
    focus: [
      { title: 'Sliding Window Maximum', difficulty: 'medium', tags: ['deque', 'focus'], targets_skill: 'focus' },
    ],
    planning: [
      { title: 'Word Break', difficulty: 'medium', tags: ['DP', 'planning'], targets_skill: 'planning' },
      { title: 'Task Scheduler', difficulty: 'medium', tags: ['greedy', 'planning'], targets_skill: 'planning' },
    ],
    flexibility: [
      { title: 'LRU Cache', difficulty: 'medium', tags: ['design', 'adaptability'], targets_skill: 'flexibility' },
    ],
  };

  const topics = [...new Set(weakAreas.flatMap(w => topicFallbackMap[w.skill] || []))].slice(0, 6);
  const questions = weakAreas.flatMap(w => questionFallbackMap[w.skill] || []).slice(0, 4);

  return {
    headline: `${w0.skill} scored ${w0.score}/100 — your primary growth area this session`,
    behavioral_story: `You completed ${submission.totalAttempts} submission attempt(s) with ${submission.passed} passing across ${behavioral?.durationLabel || '?'} of assessment time. ` +
      `Your typing averaged ${behavioral?.avgTypingSpeed || '?'} chars/sec (${behavioral?.totalTypedChars || '?'} chars typed) with ${behavioral?.totalBackspaces || '?'} total backspaces. ` +
      `${behavioral?.totalDeletionBursts > 0 ? `${behavioral.totalDeletionBursts} deletion burst(s) detected, suggesting moments of uncertainty.` : 'No major deletion bursts — relatively steady approach.'}`,
    weak_areas: weakAreas.map(w => w.skill),
    strength_note: `Your ${bestSkill[0]} score of ${bestSkill[1]}/100 was your strongest dimension.`,
    growth_areas: weakAreas.map(w => ({
      skill: w.skill,
      score: w.score,
      why_weak: `Score of ${w.score}/100 in ${w.skill} based on session behavioral signals.`,
      fix: `Practice targeted ${(topicFallbackMap[w.skill] || ['algorithms'])[0]} problems for 20 minutes daily.`,
      practice_topic: (topicFallbackMap[w.skill] || ['algorithms'])[0],
    })),
    recommended_topics: topics,
    suggested_questions: questions,
    personalized_feedback: `Your weakest area was ${w0.skill} at ${w0.score}/100. ` +
      `You recorded ${behavioral?.totalBackspaces || '?'} backspaces and ${behavioral?.totalHesitations || '?'} hesitation events. ` +
      (w1 ? `${w1.skill} at ${w1.score}/100 also needs attention. ` : '') +
      `Focus on ${topics[0]} to close the biggest gap.`,
    study_plan: [
      `Week 1: Practice ${(topicFallbackMap[w0.skill] || ['algorithms'])[0]} for 30min daily — target ${w0.skill} score from ${w0.score} to ${Math.min(w0.score + 15, 85)}`,
      `Week 2: Solve 3 problems per day from the suggested list below, focusing on ${w0.skill} and ${w1?.skill || 'debugging'}`,
      `Week 3: Retake an assessment in ${language} — measure ${w0.skill} improvement with real telemetry`,
      `Week 4: Review all flagged lines from heatmap and rewrite the hardest sections clean`,
    ],
  };
}

app.post('/generate-recommendations', async (req, res) => {
  const {
    user_id,
    scores,
    submission_errors,
    language,
    topic,
  } = req.body || {};
  let { test_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    if (!test_id) {
      const { data: latestReport } = await supabase
        .from('reports')
        .select('test_id')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      test_id = latestReport?.test_id;
    }
    if (!test_id) return res.status(400).json({ error: 'test_id required when no existing reports are found' });

    // Fetch the report row
    const { data: reportRow } = await supabase
      .from('reports')
      .select('*, skill_tests(language, topic, difficulty, question)')
      .eq('user_id', user_id)
      .eq('test_id', test_id)
      .single();

    // Fetch ALL reports for this user (for trend analysis)
    const { data: allReports } = await supabase
      .from('reports')
      .select('created_at, problem_breakdown_score, debugging_score, focus_score, planning_score, flexibility_score')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Fetch submission data
    const { data: submissions } = await supabase
      .from('submissions')
      .select('passed, execution_time, error, code')
      .eq('user_id', user_id)
      .eq('test_id', test_id)
      .order('created_at', { ascending: true });

    // Fetch keystroke aggregates
    const { data: keystrokes } = await supabase
      .from('keystroke_logs')
      .select('timestamp, typing_speed, typing_speed_avg, pause_duration_ms, pause_duration, backspace_count, deletion_bursts, hesitation_count, focus_level, code_rewrite_count, keystroke_count')
      .eq('user_id', user_id)
      .eq('test_id', test_id)
      .order('timestamp', { ascending: true });

    // Compute behavioral aggregates
    const ks = keystrokes || [];
    const totalKs = Math.max(ks.length, 1);
    const firstTs = ks[0]?.timestamp ? new Date(ks[0].timestamp).getTime() : null;
    const lastTs = ks[ks.length - 1]?.timestamp ? new Date(ks[ks.length - 1].timestamp).getTime() : null;
    const durationSeconds = (firstTs != null && lastTs != null)
      ? Math.max(1, Math.round((lastTs - firstTs) / 1000))
      : 0;
    const durationLabel = durationSeconds > 0
      ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
      : 'unknown';

    const maxKeystrokeCount = ks.reduce((m, k) => Math.max(m, Number(k.keystroke_count || 0)), 0);
    const typingSamples = ks
      .map((k) => Number(
        (typeof k.typing_speed_avg === 'number' && k.typing_speed_avg > 0)
          ? k.typing_speed_avg
          : (k.typing_speed || 0)
      ))
      .filter((v) => Number.isFinite(v) && v > 0);
    const avgTypingSpeedFromSamples = typingSamples.length
      ? typingSamples.reduce((sum, value) => sum + value, 0) / typingSamples.length
      : 0;
    const avgTypingSpeedFromCounter = (durationSeconds > 0 && maxKeystrokeCount > 0)
      ? (maxKeystrokeCount / durationSeconds)
      : 0;
    const resolvedTypingSpeed = avgTypingSpeedFromCounter > 0
      ? avgTypingSpeedFromCounter
      : avgTypingSpeedFromSamples;
    const avgTypingSpeed = (Number.isFinite(resolvedTypingSpeed) ? resolvedTypingSpeed : 0).toFixed(1);
    const totalBackspaces = ks.reduce((s, k) => s + (k.backspace_count || 0), 0);
    const totalDeletionBursts = ks.reduce((s, k) => s + (k.deletion_bursts || 0), 0);
    const totalHesitations = ks.reduce((s, k) => s + (k.hesitation_count || 0), 0);
    const avgFocusRaw = ks.reduce((s, k) => s + Number(k.focus_level || 0), 0) / totalKs;
    const avgFocus = (avgFocusRaw <= 1 ? avgFocusRaw * 100 : avgFocusRaw).toFixed(0);
    const totalRewrites = ks.reduce((s, k) => s + (k.code_rewrite_count || 0), 0);
    const totalTypedChars = maxKeystrokeCount > 0 ? maxKeystrokeCount : ks.length;

    // Compute trend: score change vs previous assessment
    const prevReport = allReports?.[1]; // index 0 is current
    const trend = prevReport ? {
      problemSolving: Math.round((reportRow.problem_breakdown_score || 0) - (prevReport.problem_breakdown_score || 0)),
      debugging: Math.round((reportRow.debugging_score || 0) - (prevReport.debugging_score || 0)),
      focus: Math.round((reportRow.focus_score || 0) - (prevReport.focus_score || 0)),
      planning: Math.round((reportRow.planning_score || 0) - (prevReport.planning_score || 0)),
      adaptability: Math.round((reportRow.flexibility_score || 0) - (prevReport.flexibility_score || 0)),
    } : null;

    // Compute sub stats
    const passedSubs = (submissions || []).filter(s => s.passed).length;
    const failedSubs = (submissions || []).filter(s => !s.passed).length;
    const subErrors = (submissions || []).filter(s => s.error).map(s => s.error).slice(0, 3);
    const testMeta = Array.isArray(reportRow?.skill_tests)
      ? reportRow.skill_tests[0]
      : reportRow?.skill_tests;

    const finalScores = {
      problemSolving: reportRow?.problem_breakdown_score || scores?.problemSolving || 50,
      debugging: reportRow?.debugging_score || scores?.debugging || 50,
      focus: reportRow?.focus_score || scores?.focus || 50,
      planning: reportRow?.planning_score || scores?.planning || 50,
      flexibility: reportRow?.flexibility_score || scores?.flexibility || 50,
    };

    // Build the rich context object to pass to generateAIRecommendations
    const richContext = {
      scores: finalScores,
      submissionErrors: subErrors.length ? subErrors : (submission_errors || []),
      language: language || testMeta?.language || 'general',
      topic: topic || testMeta?.topic || 'algorithms',
      difficulty: testMeta?.difficulty || 'medium',
      totalAssessments: allReports?.length || 1,
      trend,
      behavioral: {
        avgTypingSpeed,
        durationSeconds,
        durationLabel,
        totalTypedChars,
        totalBackspaces,
        totalDeletionBursts,
        totalHesitations,
        avgFocusPercent: avgFocus,
        totalRewrites,
      },
      submission: {
        passed: passedSubs,
        failed: failedSubs,
        totalAttempts: (submissions || []).length,
      },
      summaryLine: reportRow?.summary || '',
    };

    const recs = await generateAIRecommendations(richContext);

    const aiFeedbackPayload = {
      ...recs,
      strength_insight: recs.strength_note || '',
      growth_edge: recs.personalized_feedback || '',
      metrics: {
        totalAssessments: richContext.totalAssessments,
        submissionAttempts: richContext.submission?.totalAttempts || 0,
        passed: richContext.submission?.passed || 0,
        failed: richContext.submission?.failed || 0,
        avgTypingSpeed: richContext.behavioral?.avgTypingSpeed || '0.0',
        durationSeconds: richContext.behavioral?.durationSeconds || 0,
        durationLabel: richContext.behavioral?.durationLabel || 'unknown',
        totalTypedChars: richContext.behavioral?.totalTypedChars || 0,
        totalBackspaces: richContext.behavioral?.totalBackspaces || 0,
        totalDeletionBursts: richContext.behavioral?.totalDeletionBursts || 0,
        totalHesitations: richContext.behavioral?.totalHesitations || 0,
        avgFocusPercent: richContext.behavioral?.avgFocusPercent || '0',
        totalRewrites: richContext.behavioral?.totalRewrites || 0,
      },
    };

    await upsertRecommendationWithFallback({
      user_id,
      test_id,
      weak_areas: recs.weak_areas || [],
      recommended_topics: recs.recommended_topics || [],
      recommended_questions: recs.suggested_questions || [],
      suggested_questions: recs.suggested_questions || [],
      ai_feedback: JSON.stringify(aiFeedbackPayload),
      study_plan: recs.study_plan || [],
    });

    res.json({
      ok: true,
      user_id,
      test_id,
      ...recs,
    });
  } catch (err) {
    console.error('[generate-recommendations]', err?.message);
    res.status(500).json({ error: err.message || 'Failed to generate recommendations' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /submit-code — enhanced code submission with cognitive tracking
// ═══════════════════════════════════════════════════════════════

app.post('/submit-code', async (req, res) => {
  const { user_id, test_id, code, language_id, language, stdin = '', question_text } = req.body || {};
  if (!code || !language_id) return res.status(400).json({ error: 'code and language_id required' });

  let judgeData = null;
  let judgeError = null;

  // Try to run code via Judge0, but don't fail if it errors
  try {
    const judgeRes = await axios.post(
      `${JUDGE0_URL}/submissions?wait=true&base64_encoded=false`,
      { source_code: code, language_id: Number(language_id), stdin },
      {
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': process.env.JUDGE0_TOKEN || undefined },
        timeout: 20000,
      }
    );
    judgeData = judgeRes.data;
  } catch (err) {
    judgeError = err;
    console.warn('[submit-code] Judge0 call failed:', err?.message);
  }

  // Always try to store submission, even if Judge0 failed
  if (supabase && user_id) {
    const passed = judgeData?.status?.id === 3; // Accepted
    const execTime = judgeData ? parseFloat(judgeData.time) : null;

    console.log('[submit-code] Attempting to insert submission:', { user_id, test_id, language });
    const { data: submitData, error: submitError } = await supabase.from('submissions').insert({
      user_id,
      test_id: test_id || null,  // Allow null test_id as fallback
      code,
      language,
      output: judgeData?.stdout || '',
      error: judgeData?.stderr || judgeData?.compile_output || (judgeError ? `Judge0 error: ${judgeError.message}` : ''),
      passed: passed || false,
      execution_time: execTime,
    });

    if (submitError) {
      console.error('[submit-code] ❌ SUBMISSION INSERT FAILED:', {
        code: submitError.code,
        message: submitError.message,
        details: submitError.details,
        hint: submitError.hint,
        user_id,
        test_id,
      });
    } else {
      console.log('[submit-code] ✅ Submission stored successfully', { user_id, test_id, language, submitData });
    }
  } else {
    if (!supabase) console.warn('[submit-code] ⚠️ Supabase not initialized');
    if (!user_id) console.warn('[submit-code] ⚠️ No user_id provided, cannot store submission');
  }

  // Return response even if Judge0 failed
  if (judgeData) {
    res.json({
      output: judgeData.stdout || '',
      error: judgeData.stderr || judgeData.compile_output || '',
      status: judgeData.status?.description || 'Unknown',
      statusId: judgeData.status?.id,
      time: judgeData.time,
      memory: judgeData.memory,
      passed: judgeData.status?.id === 3,
    });
  } else if (judgeError) {
    console.error('[submit-code]', judgeError?.message);
    res.status(500).json({
      error: judgeError?.response?.data?.message || judgeError.message || 'Submission failed',
      note: 'Submission stored in database even though code execution failed'
    });
  } else {
    res.status(400).json({ error: 'Unable to process submission' });
  }
});

export default app;
