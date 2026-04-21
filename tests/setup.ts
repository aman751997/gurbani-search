// Vitest global setup. Runs before every test file.
//
// Importing jest-dom/vitest registers matchers like toBeInTheDocument() on
// expect. It is safe to import in a Node-environment test because the import
// only mutates Vitest's expect prototype — no DOM globals are touched at
// import time.
import "@testing-library/jest-dom/vitest";
