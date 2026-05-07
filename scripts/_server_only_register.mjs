import { register } from "node:module";
register(new URL("./_server_only_shim.mjs", import.meta.url));
