import fs from 'node:fs';
import { posix as path } from 'node:path';
import child_process from 'node:child_process';
import { changeExtension } from "../utils.js";

function expandEnvVars(str) {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || `%${key}%`);
}

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


/*
export class msvc
{
    #env = null

    get env()
    {
        if (!this.#env)
        {
            // Resolve location
            var vcvars = resolveMsvcLocation();
            if (vcvars == null)
                throw new Error("Unable to resolve VC vars location");

            // Run it
            try 
            {
                // Run vcvars and capture resulting environment
                let output = child_process.execSync(`"${vcvars}" x86_x64 && echo --- ENV --- && set`, 
                { 
                    encoding: "utf-8" 
                });

                // Get just the environment bit and split into lines
                output = output.split("--- ENV ---", 2)[1].replace("\r\n", "\n")

                this.#env = {};
                for (let line of output.split("\n"))
                {
                    let parts = line.split("=", 2);
                    if (parts.length == 2)
                        this.#env[parts[0]] = parts[1];
                }
            } 
            catch (error) 
            {
                throw new Error(`Unable to capture VC environment - ${error.message}`);
            }
        }

        return this.#env;
    }
}
*/

export default function()
{
    // Create defaults
    this.default({

        // Default static vars
        projectName: path.basename(this.vars.home),
        projectKind: "exe",
        srcdir: ".",
        objdir: "./build/$(config)/obj",
        outdir: "./build/$(config)/out",
        msvcrt: "MD",
        targetName: "$(projectName).$(targetExtension)",
        targetFullName: "$(outdir)/$(targetName)",
        defines: [],
        includePath: [],
        cFlags: [],
        cppFlags: [],
        warningLevel: 1,
        charset: "wchar_t",

        // Object files
        objectFiles: () => this.glob("$(srcdir)/**/*.{c,cpp}").map(x => path.join(`$(objdir)`, changeExtension(x, ".obj"))),

        // Map project kind to default file extension
        targetExtension: () => {
            var projKind = this.resolve("projectKind");
            switch (projKind)
            {
                case "winexe": return "exe";
                case "exe": return "exe";
                case "dll": return "dll";
                case "so": return "so";
                case "lib": return "lib";
            }
            throw new Error(`Unknown project kind ${projKind}`);
        },

        // Build common flags
        commonFlags: () => [
            "/nologo",
            "/Zi",
            "/Fd$(outdir)",
            "/showIncludes",
            "/W$(warningLevel)",
            "/Zc:$(charset)",
            "/FC",
            this.flatten(this.resolve("defines")).map(x => `/d,${x}`),
            this.flatten(this.resolve("includePath")).map(x => `/I,${x}`),
            this.resolve("config") == "debug"
                ? [ "/D_DEBUG", "/Od", "/$(msvcrt)d" ] 
                : [ "/DNDEBUG", "/O2", "/Oi", "/$(msvcrt)" ],
        ],
    });

    // Compile C file rule
    this.rule({
        target: "$(objdir)/*.obj",
        source: "$(srcdir)/$(1).c",
        depends: () => this.readDeps("$(objdir)/$(1).d"),
        action: [
            "cl $(commonFlags) $(cFlags) /c $(source) /Fo $(target)",
        ]
    });

    this.rule({
        target: "$(objdir)/*.obj",
        source: "$(srcdir)/$(1).cpp",
        depends: () => this.readDeps("$(objdir)/$(1).d"),
        action: [
            "cl $(commonFlags) $(cppFlags) /c $(source) /Fo $(target)",
        ]
    });

    // Link rule
    this.rule({
        target: "$(outfile)",
        source: [ this.resolve("objectFiles"), this.resolve("libFiles") ],
        action: [
            "link $(source) -o $(target) $(linkflags)"
        ]
    });
}
