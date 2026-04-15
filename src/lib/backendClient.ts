/**
 * Backend fetch helper with built-in timeout (default 8s).
 * Prevents UI from hanging indefinitely when the Python backend is down.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchBackend(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON to backend with timeout. Returns parsed JSON or throws. */
export async function postBackend<T = any>(
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const res = await fetchBackend(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
  });
  if (!res.ok) throw new Error(`Backend ${path} error: ${res.status}`);
  return res.json();
}

/** GET from backend with timeout. Returns parsed JSON or throws. */
export async function getBackend<T = any>(
  path: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const res = await fetchBackend(path, { timeoutMs });
  if (!res.ok) throw new Error(`Backend ${path} error: ${res.status}`);
  return res.json();
}

export { BACKEND_URL };
