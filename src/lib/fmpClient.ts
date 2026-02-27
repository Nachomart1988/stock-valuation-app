/**
 * Client-side FMP helper — routes requests through /api/fmp proxy
 * so the API key stays server-side and is never exposed in the browser.
 */
export async function fetchFmp(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<any[]> {
  const search = new URLSearchParams();
  search.set('path', path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }

  const res = await fetch(`/api/fmp?${search.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FMP ${path} failed: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [json];
}

/** Same as fetchFmp but returns the raw value (not wrapped in array) */
export async function fetchFmpRaw(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<any> {
  const search = new URLSearchParams();
  search.set('path', path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }

  const res = await fetch(`/api/fmp?${search.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FMP ${path} failed: ${res.status}`);
  return res.json();
}
