import { fileURLToPath, pathToFileURL } from 'node:url';
import { posix as path, default as ospath } from "node:path";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

export async function resolve(specifier, context, nextResolve) {

    // Handle: import {} from 'mk';
    if (specifier == 'mk')
    {
        return {
            shortCircuit: true,
            url: pathToFileURL(ospath.join(__dirname, "mk.js")).href
        }
    }

    let r = await nextResolve(specifier, context);

    if (r && specifier.match(/(^|[\/\\\.])mk.js$/))
    {
        r.format = "module";
    }

    return r;
}