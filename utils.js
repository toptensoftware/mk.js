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
        return arr.map(x => /\s/.test(x) ? `"${x}"` : x).join(" ");
    }
    else
    {
        return "" + arr;
    }
}

export async function run(cmdargs, opts)
{   
    console.log(JSON.stringify(cmdargs, null, 4));

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
            resolve(code);
        });

        // Error rejects the promise
        child.on('error', err => {
            chopStdout?.flush();
            chopStderr?.flush();
            reject(err);
        });

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
        }

        return fn;
    }
}
