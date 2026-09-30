/**
 * Backend API Endpoints for Keystroke Logging
 * Express routes for storing keystroke metrics in PostgreSQL
 *
 * Usage:
 * import { setupKeystrokeRoutes } from './keystrokeRoutes.mjs';
 * setupKeystrokeRoutes(app, supabase);
 */

import { insertKeystrokeLogs, validateKeystrokeLog, getKeystrokeStats } from "./keystrokeDatabase.mjs";

export function setupKeystrokeRoutes(app, supabase) {
  if (!supabase) {
    console.warn("[KeystrokeRoutes] Supabase not configured - keystroke endpoints disabled");
    return;
  }

  /**
   * POST /api/keystroke-logs
   * Batch insert keystroke logs
   *
   * Request body:
   * {
   *   events: [keystrokeLogRow, ...]
   * }
   *
   * Response:
   * {
   *   success: number,
   *   failed: number,
   *   errors: [{ index, error }, ...]
   * }
   */
  app.post("/api/keystroke-logs", async (req, res) => {
    console.log("[KeystrokeAPI] POST /api/keystroke-logs");

    try {
      const { events } = req.body;

      // Validate request
      if (!events || !Array.isArray(events)) {
        return res.status(400).json({
          error: "Invalid request: 'events' array required",
        });
      }

      if (events.length === 0) {
        return res.status(400).json({
          error: "No events to insert",
        });
      }

      // Log incoming payload
      console.log(`[KeystrokeAPI] Inserting ${events.length} keystroke logs`);
      console.log(
        "[KeystrokeAPI] Sample event:",
        JSON.stringify(events[0], null, 2).substring(0, 500)
      );

      // Insert logs
      const result = await insertKeystrokeLogs(supabase, events);

      // Log result
      console.log(`[KeystrokeAPI] ✅ Insert result: ${result.success} succeeded, ${result.failed} failed`);
      if (result.errors.length > 0) {
        console.error("[KeystrokeAPI] Errors:", result.errors);
      }

      // Return result
      res.status(result.failed === events.length ? 400 : 200).json({
        success: result.success,
        failed: result.failed,
        errors: result.errors,
      });
    } catch (error) {
      console.error("[KeystrokeAPI] Unexpected error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/keystroke-log
   * Insert single keystroke log (legacy endpoint)
   *
   * Request body: keystrokeLogRow
   */
  app.post("/api/keystroke-log", async (req, res) => {
    console.log("[KeystrokeAPI] POST /api/keystroke-log");

    try {
      const logData = req.body;

      // Validate log
      const validatedLog = validateKeystrokeLog(logData);

      // Insert
      const result = await insertKeystrokeLogs(supabase, [validatedLog]);

      if (result.failed > 0) {
        return res.status(400).json({
          error: result.errors[0]?.error || "Insert failed",
        });
      }

      res.json({
        success: true,
        message: "Keystroke logged",
      });
    } catch (error) {
      console.error("[KeystrokeAPI] Error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/keystroke-stats/:userId/:testId
   * Get keystroke statistics for a user/test
   *
   * Response:
   * {
   *   totalKeystrokes: number,
   *   avgTypingSpeed: number,
   *   avgPauseDuration: number,
   *   avgFocusLevel: number,
   *   totalErrors: number,
   *   totalHesitations: number,
   *   pasteEventCount: number,
   *   recordCount: number
   * }
   */
  app.get("/api/keystroke-stats/:userId/:testId", async (req, res) => {
    const { userId, testId } = req.params;

    console.log(`[KeystrokeAPI] GET /api/keystroke-stats/${userId}/${testId}`);

    try {
      const stats = await getKeystrokeStats(supabase, userId, testId);

      if (!stats) {
        return res.status(404).json({
          error: "No keystroke data found for this user/test",
        });
      }

      res.json(stats);
    } catch (error) {
      console.error("[KeystrokeAPI] Error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/keystroke-logs/:userId/:testId
   * Get all keystroke logs for a user/test (for debugging)
   *
   * Query params:
   * - limit: max records to return (default 100)
   * - offset: pagination offset (default 0)
   */
  app.get("/api/keystroke-logs/:userId/:testId", async (req, res) => {
    const { userId, testId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 100, 1000); // Max 1000
    const offset = Number(req.query.offset) || 0;

    console.log(`[KeystrokeAPI] GET /api/keystroke-logs/${userId}/${testId} (limit=${limit}, offset=${offset})`);

    try {
      const { data, error, count } = await supabase
        .from("keystroke_logs")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .eq("test_id", testId)
        .order("timestamp", { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("[KeystrokeAPI] Supabase error:", error);
        return res.status(500).json({
          error: error.message,
        });
      }

      res.json({
        logs: data,
        total: count,
        returned: data?.length || 0,
        limit,
        offset,
      });
    } catch (error) {
      console.error("[KeystrokeAPI] Unexpected error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/keystroke-logs/:userId/:testId
   * Delete keystroke logs for a user/test (admin only)
   */
  app.delete("/api/keystroke-logs/:userId/:testId", async (req, res) => {
    const { userId, testId } = req.params;

    console.log(`[KeystrokeAPI] DELETE /api/keystroke-logs/${userId}/${testId}`);

    try {
      // TODO: Add authentication check here
      // if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

      const { count, error } = await supabase
        .from("keystroke_logs")
        .delete()
        .eq("user_id", userId)
        .eq("test_id", testId);

      if (error) {
        console.error("[KeystrokeAPI] Delete error:", error);
        return res.status(500).json({
          error: error.message,
        });
      }

      res.json({
        deleted: count,
        message: `Deleted ${count} keystroke logs`,
      });
    } catch (error) {
      console.error("[KeystrokeAPI] Unexpected error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.log("[KeystrokeRoutes] ✅ Keystroke API routes registered");
}
