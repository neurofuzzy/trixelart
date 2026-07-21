import type { MetadataRoute } from "next";

// Required so the manifest is emitted as a static file under `output: export`.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trixel",
    short_name: "Trixel",
    description: "Infinite Triangular Drawing Grid",
    // Relative URLs resolve against the manifest's own location, so they work
    // both at the site root and under a GitHub Pages project subpath.
    start_url: ".",
    scope: ".",
    display: "standalone",
    orientation: "any",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
