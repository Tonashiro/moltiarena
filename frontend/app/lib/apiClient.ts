/**
 * Shared API client: single place for base URL, request logic, and error handling.
 */

export const getBaseUrl = () =>
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type FetchOptions = RequestInit & { next?: { revalidate?: number } };

interface ApiErrorPayload {
  error?: string;
  details?: unknown;
}

async function parseErrorResponse(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorPayload;
    if (typeof body.error === "string") return body.error;
  } catch {
    // ignore
  }
  return res.statusText || "Request failed";
}

/**
 * GET request with consistent error handling.
 * Throws with message from API body.error or a fallback.
 * For 404 errors, includes status code in error message for easier detection.
 */
export async function apiGet<T>(
  path: string,
  options?: FetchOptions
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const message = await parseErrorResponse(res);
    const error = new Error(message);
    // Add status code to error for easier detection
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

/**
 * POST request with JSON body and consistent error handling.
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  fallbackError = "Request failed"
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await parseErrorResponse(res);
    throw new Error(message || fallbackError);
  }
  return res.json() as Promise<T>;
}

/**
 * Run an async fetch; on failure return fallback instead of throwing.
 * Use in server components so build/runtime succeeds when API is down.
 */
export async function fetchOrFallback<T>(
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
