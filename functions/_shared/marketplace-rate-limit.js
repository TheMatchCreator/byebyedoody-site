// Per-account fixed-window write rate limiting backed by D1.
// Keys should be a short route label plus the authenticated opaque subject ID.
// No IP address, email address, or request payload is stored.
export async function enforceRateLimit(env, userId, scope, limit, windowSeconds) {
  if (!env.DB || !userId || !scope || !Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    return new Response(JSON.stringify({ error: "Request protection is temporarily unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const bucket = scope + ":" + userId;
  try {
    const row = await env.DB.prepare(`
      INSERT INTO api_rate_limits (bucket_key, window_started_at, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(bucket_key) DO UPDATE SET
        request_count = CASE
          WHEN api_rate_limits.window_started_at = excluded.window_started_at
          THEN api_rate_limits.request_count + 1
          ELSE 1
        END,
        window_started_at = excluded.window_started_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING request_count
    `).bind(bucket, windowStart).first();
    if (Number(row?.request_count || 0) <= limit) return null;
    const retryAfter = Math.max(1, windowStart + windowSeconds - now);
    return new Response(JSON.stringify({
      error: "Too many requests. Please wait before trying again.",
      retryAfterSeconds: retryAfter
    }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfter)
      }
    });
  } catch (error) {
    console.error("Marketplace rate limit check failed:", error?.message || "database_error");
    return new Response(JSON.stringify({ error: "Request protection is temporarily unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
}
