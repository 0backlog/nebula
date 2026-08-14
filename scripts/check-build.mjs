/* The build gate. Three things are worth failing a build over:
 *   1. the bundle opens with "use client". A React Server Components host that
 *      imports a client component without it gets a hard error, and the
 *      bundler drops the directive on its own (see scripts/finish-build.mjs).
 *   2. the declarations exist, so a TypeScript consumer is not left with any.
 *   3. the face asset shipped as data next to the bundle. */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const fail = (m) => {
  console.error(`build check: ${m}`);
  process.exit(1);
};

const bundle = readFileSync(join(dist, "index.js"), "utf8");
if (!bundle.startsWith('"use client";') && !bundle.startsWith("'use client';")) {
  fail(`dist/index.js does not open with the "use client" directive`);
}
for (const f of ["index.d.ts", "face-neutral.json"]) {
  try {
    statSync(join(dist, f));
  } catch {
    fail(`dist/${f} is missing`);
  }
}
console.log("build check: ok");
