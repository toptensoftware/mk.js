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


export default async function() {

    // Default variables
    this.default({
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

    // Callback lambda to compile a c or c++ file
    let compile = () => ({
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
            ...this.resolveArray("msvc_cl_args"),
            '/c', "$(ruleFirstInput)",
            `/Fo$(ruleOutput)`,
        ],
        opts: {
            env: captureMsvcEnvironment(),
        }
    })

    // Compile C Code
    this.rule({
        output: "$(objdir)/%.obj",
        input: "$(srcdir)/%.c",
        name: "compile",
        mkdir: true,
        action: compile,
    });

    // Compile C++ Code
    this.rule({
        output: "$(objdir)/%.obj",
        input: "$(srcdir)/%.cpp",
        name: "compile",
        mkdir: true,
        action: compile,
    });

    // Link (.exe or .dll)
    this.rule({
        output: "$(outputFile)",
        input: () => this.resolveArray("objFiles"),
        name: "link",
        mkdir: true,
        condition: () => !this.resolveString("projectKind").match(/lib|a/),
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
                ...this.resolveString("ruleOutput").endsWith(".exe") ? [] : [ "/DLL" ],
                ...this.resolveArray("msvc_link_flags"),
                `/out:$(ruleOutput)`,
                `/pdb:${changeExtension(this.resolveString("ruleOutput"), ".pdb")}`
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });

    // Create library (.lib)
    this.rule({
        output: "$(outputFile)",
        input: () => this.resolveArray("objFiles"),
        name: "lib",
        mkdir: true,
        condition: () => !!this.resolveString("projectKind").match(/lib|a/),
        action: () => ({
            cmdargs: [
                `@lib.exe`,
                `/nologo`,
                ...this.resolveArray("ruleInput"),
                ...this.resolveArray("msvc_lib_flags"),
                `/out:$(ruleOutput)`,
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });
}
