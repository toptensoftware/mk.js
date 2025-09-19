import { posix as path } from 'node:path';

export function changeExtension(filename, newExt)
{
    const parsed = path.parse(filename);
    parsed.ext = newExt.startsWith(".") ? newExt : "." + newExt;
    parsed.base = parsed.name + parsed.ext;
    return path.format(parsed);
}

export function resolve(str, resolveVar)
{
    if (typeof(str) === "number")
        str = "" + str;
    return str.replace(/\$\(([^)]+)\)/g, (_, key) => resolveVar(key));
}

export function quotedJoin(arr)
{
    if (Array.isArray(arr))
    {
        return arr.map(x => /\s/.test(x) ? `"${x}"` : x).join(" ");
    }
    else
    {
        return "" + arr;
    }
}