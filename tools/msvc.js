import fs from 'node:fs';
import { posix as path } from 'node:path';
import { execSync } from 'node:child_process';
import { run, ensureArray, changeExtension } from "../utils.js";

// Expand windows style environment variables
function expandEnvVars(str) {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || `%${key}%`);
}

// Work out default install location for msvc
function resolveMsvcLocation()
{
    // Look for vcvars
    let paths = [
        "%PROGRAMFILES%\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat",
        "%PROGRAMFILES(x86)%\\Microsoft Visual Studio\\2019\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat",
    ];

    for (let p of paths)
    {
        let expanded = expandEnvVars(p);
        if (fs.existsSync(expanded))
            return expanded;
    }

    return null;
}

let msvc_env;
function captureMsvcEnvironment()
{
    if (msvc_env)
        return msvc_env;

    // Resolve location
    var vcvars = resolveMsvcLocation();
    if (vcvars == null)
        throw new Error("Unable to resolve VC vars location");

    // Run it
    try 
    {
        // Run vcvars and capture resulting environment
        let output = execSync(`"${vcvars}" x86_x64 && echo --- ENV --- && set`, 
        { 
            encoding: "utf-8" 
        });

        // Get just the environment bit and split into lines
        output = output.split("--- ENV ---", 2)[1].replace("\r\n", "\n")
        msvc_env = {};
        for (let line of output.split("\n"))
        {
            let parts = line.split("=", 2);
            if (parts.length == 2)
               msvc_env[parts[0]] = parts[1].trim();
        }

        // Done
        return msvc_env;
    } 
    catch (error) 
    {
        throw new Error(`Unable to capture VC environment - ${error.message}`);
    }
}


export let msvc =
{
    // Compiles a file
    // opts.input - the file to compile (required)
    // opts.output - the generated .obj file (defaults to input renamed to .obj)
    // opts.pdb - the generated .pdb file (defaults to output directory of .obj)
    // opts.warningLevel - compiler warning level (defaults to 1)
    // opts.define - an array of preprocessor definitions
    // opts.includePath - an array of include paths
    // opts.debug - true to if this is debug build (default = true)
    // opts.msvcrt - runtime library to use (default = "MD")
    // opts.otherArgs - an array of other command line args
    // opts.env - additional environment variables
    // opts.cwd - current working directory
    compile(opts)
    {
        if (!opts.input)
            throw new Error("'input' file option not specified");

        // Resolve output file
        let out = opts.output ?? changeExtension(opts.input, "obj");

        // Resolve pdb file or directory
        let pdb = opts.pdb;
        if (!opts.pdb)
        {
            pdb = path.dirname(out) ?? ".";
            if (!pdb.endsWith("/"))
                pdb += "/";
        }

        // Setup args
        let cmdargs = [
            `cl.exe`,
            `/nologo`,
            `/Zi`,
            `/Fd${pdb}`,
            `/showIncludes`,
            `/W${opts.warningLevel ?? 1}`,
            `/Zc:wchar_t`,
            `/FC`,
            ...ensureArray(opts.define).map(x => `/d,${x}`),
            ...ensureArray(opts.includePath).map(x => `/I,${x}`),
            ...(opts.debug ?? true)
                ? [ "/D_DEBUG", "/Od", `/${opts.msvcrt ?? "MD"}d` ] 
                : [ "/DNDEBUG", "/O2", "/Oi", `/${opts.msvcrt ?? "MD"}` ],
            ...ensureArray(opts.otherArgs),
            '/c', opts.input,
            `/Fo${out}`,
        ]

        // Setup environment
        let env = Object.assign(captureMsvcEnvironment(), opts.env);

        // Run it
        return run(cmdargs, {
            env,
            shell: false,
            cwd: opts.cwd,
        });
    },

    // Link .obj files into a .exe or .dll
    // opts.input - array of object files
    // opts.output - the target .exe or .dll file name
    // opts.debug - true for debug build (default = true)
    // opts.libs - array of additional libraries to link with
    // opts.dll - generate a dll instead of .exe (default = true unless output ends with .exe)
    // opts.debug - true to if this is debug build (default = true)
    // opts.otherArgs - an array of other command line args
    // opts.env - additional environment variables
    // opts.cwd - current working directory
    link(opts)
    {
        if (!opts.input)
            throw new Error("'input' option not specified");
        if (!opts.output)
            throw new Error("'output' option not specified");

        // Setup args
        let cmdargs = [
            `link.exe`,
            `/nologo`,
            `/DEBUG`,
            ...(opts.debug ?? true)
                ? [  ] 
                : [ "/OPT:REF", "/OPT:ICF" ],
            ...ensureArray(opts.libs),
            ...ensureArray(opts.input),
            (opts.dll ?? !opts.output.endsWith(".exe")) ? "/DLL" : null,
            ...ensureArray(opts.otherArgs),
            `/out:${opts.output}`,
            `/pdb:${changeExtension(opts.output, ".pdb")}`
        ]

        // Setup environment
        let env = Object.assign(captureMsvcEnvironment(), opts.env);

        // Run it
        return run(cmdargs, {
            env,
            shell: false,
            cwd: opts.cwd,
        });
    },

    // Create a library
    // opts.input - array of object files
    // opts.output - the target .lib file
    // opts.otherArgs - an array of other command line args
    // opts.env - additional environment variables
    // opts.cwd - current working directory
    archive(opts)
    {
        if (!opts.input)
            throw new Error("'input' option not specified");
        if (!opts.output)
            throw new Error("'output' option not specified");

        // Setup args
        let cmdargs = [
            `lib.exe`,
            `/nologo`,
            ...ensureArray(opts.input),
            ...ensureArray(opts.otherArgs),
            `/out:${opts.output}`,
        ]

        // Setup environment
        let env = Object.assign(captureMsvcEnvironment(), opts.env);

        // Run it
        return run(cmdargs, {
            env,
            shell: false,
            cwd: opts.cwd,
        });
    }
}


export default async function() {

    this.define({
        srcdir: ".",
        projectKind: "exe",
        objdir: "./build/$(config)/obj",
        outdir: "./build/$(config)/bin",
        outputFile: "$(outdir)/$(name).$(outputExtension)",
        pdb: () => path.dirname(this.resolve("ruleOutput")) + "/",
        warningLevel: 1,
        define: [],
        includePath: [],
        msvcrt: "MD",
        outputExtension: () => {
            let projKind = this.resolveString("projectKind")
            switch (projKind)
            {
                case "exe": 
                    return "exe";

                case "so":
                case "dll":
                    return "dll";
                    
                case "lib":
                case "a":
                    return "lib";
            }
            throw new Error(`Unknown project kind: ${projKind}.  Expected 'exe', 'so'/'dll' or 'lib'/'a'"`)
        }
    });

    this.rule({
        output: "$(objdir)/%.obj",
        input: "$(srcdir)/%.c",
        name: "compile",
        mkdir: true,
        action: () => ({
            cmdargs: [
                `@cl.exe`,
                `/nologo`,
                `/Zi`,
                `/Fd$(pdb)`,
                `/showIncludes`,
                `/W$(warningLevel)`,
                `/Zc:wchar_t`,
                `/FC`,
                ...this.resolveArray("define").map(x => `/d,${x}`),
                ...this.resolveArray("includePath").map(x => `/I,${x}`),
                ...(this.resolveString("config") == "debug")
                    ? [ "/D_DEBUG", "/Od", `/$(msvcrt)d` ] 
                    : [ "/DNDEBUG", "/O2", "/Oi", `/$(msvcrt)` ],
                ...this.resolveArray("msvc_c_args"),
                '/c', "$(ruleFirstInput)",
                `/Fo$(ruleOutput)`,
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });

    this.rule({
        output: "$(outputFile)",
        input: () => this.resolveArray("objFiles"),
        name: "link",
        mkdir: true,
        action: () => ({
            cmdargs: [
                `@link.exe`,
                `/nologo`,
                `/DEBUG`,
                ...(this.resolveString("config") == "debug")
                    ? [  ] 
                    : [ "/OPT:REF", "/OPT:ICF" ],
                ...this.resolveArray("libs"),
                ...this.resolveArray("ruleInput"),
                this.resolveString("ruleTarget").endsWith(".exe") ? null : "/DLL",
                ...this.resolveArray("msvc_link_flags"),
                `/out:$(ruleOutput)`,
                `/pdb:${changeExtension(this.resolveString("ruleOutput"), ".pdb")}`
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });
}
