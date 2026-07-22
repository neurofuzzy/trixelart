import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Turn a human-entered project name into a safe file-name stem: lowercased,
 *  non-alphanumeric runs collapsed to `_`, and leading/trailing `_` stripped. */
export function normalizeProjectFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export const DEFAULT_PROJECT_NAME = "Untitled";
