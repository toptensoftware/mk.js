import url from "node:url";
import fs from "node:fs";
import { posix as path, default as ospath } from "node:path";
import { globSync } from "glob";
import { msvc } from "./tools/msvc.js";

// Path to self    
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

