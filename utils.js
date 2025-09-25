import fs from 'node:fs';
import { posix as path, default as ospath } from 'node:path';
import { spawn } from 'node:child_process';

export function ensureArray(x)
{
    if (Array.isArray(x))
        return x.flat(Infinity);
    if (x === undefined)
        return [];
    return [x];
}

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
        arr = arr.flat(Infinity);
        return arr.map(x => /\s/.test(x) ? `"${x.replace(/\"/g, "\"\"")}"` : x).join(" ");
    }
    else
    {
        return "" + arr;
    }
}

export function quotedSplit(str)
{
    const rx = /"((?:[^"]|"")*)"|(\S+)/g;
    const result = [];
    let match;

    while ((match = rx.exec(str)) !== null) 
    {
        if (match[1] !== undefined) 
        {
            // Inside quotes: replace "" with "
            result.push(match[1].replace(/""/g, '"'));
        } 
        else 
        {
            // Unquoted token
            result.push(match[2]);
        }
    }

    return result;
}

export async function run(cmdargs, opts)
{   
    // Split cmdargs into cmd and args
    let cmd;
    let args;
    if (Array.isArray(cmdargs))
    {
        cmd = cmdargs[0];
        args = cmdargs.slice(1);
    }
    else
    {
        cmd = cmdargs;
        args = [];
    }

    // Remove no-op args
    args = args.filter(x => x !== undefined && x !== null && x.trim() != "");

    // Defaults
    opts = Object.assign({
        shell: true,
        encoding: 'utf-8',
    }, opts);

    // Setup stdio
    if (!opts.stdio)
        opts.stdio = 'inherit';
    if (!Array.isArray(opts.stdio))
        opts.stdio = [ opts.stdio, opts.stdio, opts.stdio ];
    if (opts.stdout)
        opts.stdio[1] = 'pipe';
    if (opts.stderr)
        opts.stdio[2] = 'pipe';

    return new Promise((resolve, reject) => {

        // Spawn process
        let child = spawn(cmd, args, opts);

        // Connect stdout callback
        let chopStdout;
        if (opts.stdout)
        {
            chopStdout = chop(opts.stdout);
            child.stdout.on('data', chopStdout);
        }

        // Connect stderr callback
        let chopStderr;
        if (opts.stderr)
        {
            chopStderr = chop(opts.stderr);
            child.stderr.on('data', chopStdout);
        }

        // Exit resolves the promise
        child.on('exit', code => {
            chopStdout?.flush();
            chopStderr?.flush();

            if (code == 0 || opts.ignoreExitCode)
            {
                resolve(code);
            }
            else
            {
                reject(adornError(new Error(`command '${cmd}' exited with code ${code}`)));
            }
        });

        // Error rejects the promise
        child.on('error', err => {
            chopStdout?.flush();
            chopStderr?.flush();
            reject(adornError(err));
        });

        // Attach info about a failed command to the error object
        function adornError(err)
        {
            err.info = { cmdargs,  opts };
            return err;
        }
    });

    // Creates a function that when passed a sequence of 
    // strings, processes them into individual lines and 
    // calls the supplied callback.
    // The returned function, has an attach function 'flush'
    // to flush any still buffered content.
    function chop(cb)
    {
        let buf = "";

        function fn(data)
        {
            buf += data;
            while (true)
            {
                let nlPos = buf.indexOf('\n');
                if (nlPos < 0)
                    break;

                let crPos = nlPos;
                if (crPos > 0 && buf[crPos-1] == '\r')
                    crPos--;

                cb(buf.substring(0, crPos));
                buf = buf.substring(nlPos+1);
            }
        }

        // Attach the flush function
        fn.flush = function()
        {
            if (buf.length > 0)
            {
                cb(buf);
                buf = "";
            }
            cb(null);     // EOF notice
        }

        return fn;
    }
}

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function fileTime(filename)
{
    try 
    {
        let s = fs.statSync(filename);
        return s.mtimeMs;
    } 
    catch (e) 
    {
        if (e.code !== 'ENOENT')
            throw e;
        return 0;
    }
}

export function toString(val)
{
    // Nullish?
    if (val === null || val === undefined)
        return "";

    // Join arrays
    if (Array.isArray(val))
        return quotedJoin(val.flat(Infinity).map(x => toString(x)));

    // Convert types
    switch (typeof(val))
    {
        case 'string':
            return val;

        case 'number':
        case 'boolean':
            return val.toString();
    }

    throw new Error(`Cannot convert value to string: ${val}`);  
}

export function toBool(val)
{
    // Nullish?
    if (val === null || val === undefined)
        return false;

    // Eval
    switch (typeof(val))
    {
        case 'boolean':
            return val;

        case 'number':
            return val != 0;

        case 'string':
            return 
                val.trim().toLowerCase() === "true" || 
                val.trim().toLowerCase() === "yes" ||
                val.trim() === "1";

        case 'object':
            if (Array.isArray(val))
                return val.length > 0;
            return true;
    }

    throw new Error(`Cannot convert value to boolean: ${val}`); 
}

export function toArray(val)
{
    // Nullish?
    if (val === null || val === undefined)
        return [];

    // String?
    if (typeof(val) === "string")
        return quotedSplit(val);

    // Wrap non-arrays
    if (Array.isArray(val))
        return val;

    return [ val ];
}


export function cache(target)
{
    let result = undefined;
    let called = false;
    let fn = function()
    {
        if (!called)
        {
            result = target.apply(this, arguments);
            called = true;
        }

        return result;
    }

    fn.flush = function()
    {
        called = false;
        result = undefined;
    }

    return fn;
}