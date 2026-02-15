import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parse string to number; returns 0 if invalid. */
export function parseNum(val: string): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}
