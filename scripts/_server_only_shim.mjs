// Resolver hook for tsx/node scripts that import lib/ modules which themselves
// import 'server-only'. When run as a Node script (not via Next.js / Vitest +
// React plugin), 'server-only' throws. We redirect it to an empty module.
import { resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);
const emptyUrl = pathToFileURL(pathResolve(here, "..", "_empty.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: emptyUrl, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
