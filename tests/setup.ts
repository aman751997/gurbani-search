// Vitest global setup. Runs before every test file.
//
// Importing jest-dom/vitest registers matchers like toBeInTheDocument() on
// expect. It is safe to import in a Node-environment test because the import
// only mutates Vitest's expect prototype — no DOM globals are touched at
// import time.
import "@testing-library/jest-dom/vitest";

// ---------------------------------------------------------------------------
// localStorage shim for the jsdom environment.
//
// vitest 2 + jsdom 29 sometimes exposes `window.localStorage` as a bare
// object without Storage.prototype methods (getItem/setItem/removeItem/clear).
// Component code paths that use localStorage (U9's GurmukhiSizeControl)
// would throw TypeError at runtime in tests even though browsers implement
// the full API.
//
// The shim below installs a minimal in-memory Storage on window and global
// scope so tests can exercise real storage semantics. If the environment
// already provides a complete Storage (non-jsdom, or a future vitest version
// with a fixed jsdom), the shim is skipped.
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  const w = window as unknown as { localStorage?: Storage };
  const existing = w.localStorage;
  const looksBroken =
    !existing || typeof (existing as Storage).getItem !== "function";
  if (looksBroken) {
    const backing = new Map<string, string>();
    const shim: Storage = {
      get length() {
        return backing.size;
      },
      clear() {
        backing.clear();
      },
      getItem(key: string) {
        return backing.has(key) ? (backing.get(key) as string) : null;
      },
      key(index: number) {
        return Array.from(backing.keys())[index] ?? null;
      },
      removeItem(key: string) {
        backing.delete(key);
      },
      setItem(key: string, value: string) {
        backing.set(key, String(value));
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: shim,
    });
  }
}
