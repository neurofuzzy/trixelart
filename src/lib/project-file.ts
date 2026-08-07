import { generateSVG, type SVGExportOptions } from "@/lib/svg-export";
import { normalizeProjectFilename } from "@/lib/utils";
import type { ProjectSnapshot } from "@/hooks/use-history";
import type { NoisePeriod } from "@/lib/subdivision-noise";

/**
 * The project file: an SVG that draws the artwork and carries the project's
 * JSON inside it.
 *
 * The point is the **thumbnail**. A `.json` project is an opaque blob in a file
 * browser; an SVG is rendered by Finder and by Nautilus (though not by Windows
 * Explorer, which has no native SVG thumbnailer), so the user sees their piece
 * in the folder listing.
 *
 * This is a container swap, not a data change. The payload is the same object
 * the old `.json` format held, so the whole legacy migration path in
 * `TrixelGrid`'s importer serves both containers unchanged — and a payload
 * lifted out of the CDATA with a text editor and saved as `.json` still loads,
 * which is a free recovery route if a file is ever damaged.
 *
 * Pure except `readProjectFile`, which uses `DOMParser`.
 */

/** Stable and unversioned. Putting the version in the URI is the classic
 *  mistake: it makes every older reader fail to find the element at all.
 *  Version by attribute instead. */
export const TRIXEL_NS = "https://neurofuzzy.github.io/trixelart/ns/project";

/**
 * The **envelope** version — where the payload lives and how it is encoded.
 * Deliberately distinct from the `version` field *inside* the payload, which
 * says what the project data means. Moving to, say, compressed base64 would bump
 * this and leave the payload's own version alone; adding a field to
 * `ProjectSnapshot` is the reverse.
 */
export const CONTAINER_VERSION = 1;

export const PROJECT_FILE_EXT = ".trixel.svg";

/** Matches the editor's own background (`--background` in `globals.css`, and
 *  `themeColor` in `app/layout.tsx`), so the thumbnail looks like the app. */
export const PROJECT_BG = "#09090b";

/** Used when the project has no name — unchanged from the `.json` era. */
const FALLBACK_STEM = "trixel-grid";

/**
 * What a project file holds: a `ProjectSnapshot` plus the few things that are
 * view state but belong with the artwork.
 *
 * These extras are all things `trixel-settings` also holds, but which describe
 * the *document* rather than the workspace, so they have to travel with it:
 * `hueOffset`/`saturationOffset` shift every resolved colour, and
 * `gridOrientation` turns the whole lattice a quarter turn. Without them a
 * project reopens looking unlike the thumbnail inside its own file. The names
 * match the `trixel-settings` blob's.
 *
 * The rest of the grid settings — divisions, hex mode, flower radius, symmetry —
 * are already in `ProjectSnapshot` and arrive through the spread.
 */
export interface ProjectPayload extends ProjectSnapshot {
  name: string;
  svgExport: SVGExportOptions;
  hueOffset: number;
  saturationOffset: number;
  gridOrientation: string;
  version: number;
}

/**
 * A CDATA section ends at the first `]]>`, and a payload can contain one — a
 * user can type it into a project or layer name.
 *
 * Escaping it at the *JSON* level rather than splitting the CDATA section keeps
 * the file to a single section, which is what lets the regex fallback in
 * `readProjectFile` stay exact. `>` is a valid JSON escape that parses back
 * to the identical character, so no unescaping step is needed on read.
 *
 * Safe because `]]>` can only ever occur inside a JSON string literal: nothing
 * structural may follow a `]` except `,`, `]`, `}` or whitespace, so the `>` —
 * and therefore both `]`s before it — are inside one string. Overlaps are
 * covered too: the replacement ends in `e`, so it cannot produce a new `]]>`.
 */
function cdataSafe(json: string): string {
  return json.replace(/\]\]>/g, "]]\\u003e");
}

/** `{slug}.trixel.svg`. Note `normalizeProjectFilename` collapses dots, so a
 *  project actually named "foo.trixel.svg" becomes `foo_trixel_svg.trixel.svg`
 *  rather than growing a double extension. */
export function projectFileName(projectName: string): string {
  return `${normalizeProjectFilename(projectName) || FALLBACK_STEM}${PROJECT_FILE_EXT}`;
}

/**
 * The saved file.
 *
 * Draws `payload.layers` rather than taking the artwork as a second argument,
 * so a file whose thumbnail disagrees with its data is unrepresentable. Hidden
 * layers are skipped by `buildRenderPlan`, so the picture shows what the canvas
 * shows while the payload still carries everything.
 *
 * The drawing is always merged and stroked, *not* the user's `svgExport`
 * options: merging is the biggest size lever and same-colour strokes close the
 * antialiasing seams between abutting fills (the problem `png-export.ts`
 * documents at length), and a project file's bytes should not change because
 * someone toggled a checkbox in an unrelated export dialog.
 */
export function buildProjectSVG(
  payload: ProjectPayload,
  noisePeriod?: NoisePeriod,
  /** The lattice's quarter turn. The payload records `gridOrientation` so the
   *  project reopens the right way round; this turns the *drawing*, which is
   *  what a file browser or an SVG viewer shows. */
  gridRotation = 0,
): string {
  const json = cdataSafe(JSON.stringify(payload, null, 2));
  // The namespace is declared on the element that uses the prefix, not on the
  // root, so `generateSVG` needs to know nothing about it.
  const metadata =
    `  <metadata>\n` +
    `    <trixel:project xmlns:trixel="${TRIXEL_NS}" version="${CONTAINER_VERSION}"><![CDATA[\n` +
    `${json}\n` +
    `]]></trixel:project>\n` +
    `  </metadata>`;

  return generateSVG(payload.layers, {
    stroke: true,
    merge: true,
    background: PROJECT_BG,
    metadata,
    // A second argument rather than a payload field: the crop is workspace
    // state, and folding it into the payload would silently add it to every
    // saved project file.
    period: noisePeriod,
    rotation: gridRotation,
  });
}

export type ReadResult =
  | { ok: true; json: string; source: "svg" | "json" }
  | { ok: false; error: string };

interface Extracted {
  json: string;
  /** Set when the container is newer than this build can decode. */
  futureVersion?: number;
}

function extractPayload(text: string): Extracted | null {
  // `image/svg+xml` parsing is inert: no scripts run, and nothing here is ever
  // inserted into the live document — only `textContent` is read out. Keep it
  // that way if a preview of the loaded file is ever added.
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");

  if (!doc.querySelector("parsererror")) {
    // By namespace URI, not by prefix: a tool that rewrote the document may have
    // renamed `trixel:` to anything, and the URI survives that.
    const el = doc.getElementsByTagNameNS(TRIXEL_NS, "project")[0];
    if (!el) return null; // A well-formed SVG that simply isn't ours.
    const v = Number(el.getAttribute("version") ?? CONTAINER_VERSION);
    if (Number.isFinite(v) && v > CONTAINER_VERSION) {
      return { json: "", futureVersion: v };
    }
    // `textContent` reads CDATA, escaped text and several adjacent sections
    // identically, so any serialisation another tool might have produced works.
    return { json: el.textContent ?? "" };
  }

  // The XML is malformed — but the drawing being mangled is no reason to lose
  // the project, so try for the payload directly. Exact for files we wrote,
  // since `cdataSafe` guarantees a single CDATA section.
  const m = text.match(
    /<[\w.-]*:?project\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/,
  );
  return m ? { json: m[1] } : null;
}

/**
 * Reads either container and hands back the payload **as text**.
 *
 * Text, not a parsed object, on purpose: the importer's migration block reads
 * some thirty properties off an untyped `data`, and handing it a typed object
 * would mean casting at every one of them. A legacy `.json` file therefore
 * passes straight through and takes exactly the path it always did.
 *
 * Detection is by content, not by extension — the picker now accepts both, and
 * a file can always be renamed.
 */
export function readProjectFile(raw: string): ReadResult {
  // `readAsText` already strips a UTF-8 BOM, but a file that arrived some other
  // way may still carry one, and it would defeat the sniff below.
  const text = raw.replace(/^\uFEFF/, "");
  const head = text.slice(0, 512).trimStart();

  // Legacy `.json`, including the ancient bare painted map.
  if (head.startsWith("{")) return { ok: true, json: text, source: "json" };

  if (head.includes("<svg") || head.startsWith("<?xml")) {
    const found = extractPayload(text);
    if (!found) {
      return {
        ok: false,
        error:
          "That SVG doesn't contain Trixel project data. Only files saved with " +
          "Save Project (.trixel.svg) can be loaded.",
      };
    }
    if (found.futureVersion !== undefined) {
      return {
        ok: false,
        error:
          `This project was saved by a newer version of Trixel ` +
          `(file format ${found.futureVersion}).`,
      };
    }
    if (!found.json.trimStart().startsWith("{")) {
      return { ok: false, error: "The project data in that file is corrupt." };
    }
    return { ok: true, json: found.json, source: "svg" };
  }

  return {
    ok: false,
    error: "Unrecognised file. Expected a .trixel.svg or .json project.",
  };
}
