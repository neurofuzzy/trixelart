/**
 * The bundled example projects.
 *
 * They are ordinary `.trixel.svg` project files in `public/examples/`, saved by
 * the app itself — not a separate format, not generated at build time. So a new
 * example is added by drawing it, saving it into that folder and adding a line
 * here, and it is the same file a user would get from Save Project.
 *
 * Listed explicitly rather than discovered: a static export has no directory
 * index to read, and an explicit list is also what lets the order and the
 * display names be chosen.
 */

export interface Example {
  /** File name inside `public/examples/`. */
  file: string;
  /** Shown in the picker. The payload carries its own `name`, which becomes the
   *  project name on load — this is just the label. */
  name: string;
}

export const EXAMPLES: Example[] = [
  { file: "mandala.trixel.svg", name: "Mandala" },
  { file: "pinwheel.trixel.svg", name: "Pinwheel" },
  { file: "basketweave.trixel.svg", name: "Basketweave" },
  { file: "waterwheel.trixel.svg", name: "Waterwheel" },
  { file: "purple_cabbage.trixel.svg", name: "Purple Cabbage" },
  { file: "party_favors.trixel.svg", name: "Party Favors" },
];

/**
 * URL for an example, prefixed for wherever the app is mounted.
 *
 * `basePath` does not apply to `fetch` or to a plain `<img src>`, so on GitHub
 * Pages (served from `/trixelart/`) an absolute `/examples/...` would 404. The
 * prefix comes from `NEXT_PUBLIC_BASE_PATH`, set in `next.config.ts` from the
 * same constant that sets `basePath`, so the two cannot drift.
 */
export function exampleUrl(file: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/examples/${file}`;
}

/** Fetches an example's raw text, ready for `readProjectFile`. */
export async function fetchExample(file: string): Promise<string> {
  const res = await fetch(exampleUrl(file));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}
