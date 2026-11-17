export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
export const sameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
};
export async function activeAccount(env, user) {
  const a = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  return Boolean(a && a.role === user.role && a.account_status === "active");
}
export async function readJson(request, max = 8000) {
  if (Number(request.headers.get("Content-Length") || 0) > max) throw new Error("too_large");
  return request.json();
}
