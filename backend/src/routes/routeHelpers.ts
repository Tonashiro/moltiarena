import { Response } from "express";
import { ZodError } from "zod";

/**
 * Parse a numeric ID from route params. Sends 400 and returns null if invalid.
 */
export function parseId(
  value: string | undefined,
  paramName: string,
  res: Response
): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: `Invalid ${paramName}` });
    return null;
  }
  return id;
}

/**
 * Handle route handler errors: ZodError -> 400, else log and 500.
 * Call after catch (e) { handleRouteError(e, res, "GET /path"); return; }
 */
export function handleRouteError(
  e: unknown,
  res: Response,
  context: string
): void {
  if (e instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: e.flatten(),
    });
    return;
  }
  console.error(`${context} error:`, e);
  res.status(500).json({ error: "Internal server error" });
}
