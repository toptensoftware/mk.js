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
        sourceDir: ".",
        projectKind: "exe",
        objDir: "./build/$(config)/obj",
        outputDir: "./build/$(config)/bin",
        outputFile: "$(outputDir)/$(projectName).$(outputExtension)",
        pdb: () => path.dirname(this.ruleOutput) + "/",
        warningLevel: 1,
        defines: [],
        includePath: [],
        msvcrt: "MD",
        outputExtension: () => {
            switch (this.projectKind)
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
            throw new Error(`Unknown project kind: ${this.projectKind}.  Expected 'exe', 'so'/'dll' or 'lib'/'a'"`)
        }
    });

    // Callback lambda to compile a c or c++ file
    let compile = () => this.exec({
        cmdargs: [
            `@cl.exe`,
            `/nologo`,
            `/Zi`,
            `/Fd$(pdb)`,
            `/showIncludes`,
            `/W$(warningLevel)`,
            `/Zc:wchar_t`,
            `/FC`,
            ensureArray(this.defines).map(x => `/d,${x}`),
            ensureArray(this.includePath).map(x => `/I,${x}`),
            this.config == "debug"
                ? [ "/D_DEBUG", "/Od", `/$(msvcrt)d` ] 
                : [ "/DNDEBUG", "/O2", "/Oi", `/$(msvcrt)` ],
            this.msvc_cl_args,
            '/c', "$(ruleFirstInput)",
            `/Fo$(ruleOutput)`,
        ],
        opts: {
            env: captureMsvcEnvironment(),
        }
    })

    // Compile C Code
    this.rule({
        output: "$(objDir)/%.obj",
        input: "$(sourceDir)/%.c",
        name: "compile",
        mkdir: true,
        action: compile,
    });

    // Compile C++ Code
    this.rule({
        output: "$(objDir)/%.obj",
        input: "$(sourceDir)/%.cpp",
        name: "compile",
        mkdir: true,
        action: compile,
    });

    // Link (.exe or .dll)
    this.rule({
        output: "$(outputFile)",
        input: () => this.objFiles,
        name: "link",
        mkdir: true,
        condition: () => !this.projectKind.match(/lib|a/),
        action: () => this.exec({
            cmdargs: [
                `@link.exe`,
                `/nologo`,
                `/DEBUG`,
                this.config == "debug"
                    ? [  ] 
                    : [ "/OPT:REF", "/OPT:ICF" ],
                this.libs,
                this.ruleInput,
                this.ruleOutput.endsWith(".exe") ? [] : [ "/DLL" ],
                this.msvc_link_args,
                `/out:$(ruleOutput)`,
                `/pdb:${changeExtension(this.ruleOutput, ".pdb")}`
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });

    // Create library (.lib)
    this.rule({
        output: "$(outputFile)",
        input: () => this.objFiles,
        name: "lib",
        mkdir: true,
        condition: () => !!this.projectKind.match(/lib|a/),
        action: () => this.exec({
            cmdargs: [
                `@lib.exe`,
                `/nologo`,
                this.ruleInput,
                this.msvc_lib_args,
                `/out:$(ruleOutput)`,
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });
}
