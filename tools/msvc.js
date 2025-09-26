import fs from 'node:fs';
import { posix as path, default as ospath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { cache, ensureArray, changeExtension } from "../utils.js";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

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

    let self = this;

    // Default variables
    this.default({
        sourceDir: ".",
        projectKind: "exe",
        buildDir: "./build",
        objDir: "$(buildDir)/$(config)/obj",
        outputDir: "$(buildDir)/$(config)/bin",
        outputFile: "$(outputDir)/$(projectName).$(outputExtension)",
        sourceFiles: cache(() => this.glob("$(sourceDir)/*.{c,cpp}")),
        objFiles: () => this.sourceFiles.map(x => `${this.objDir}/${changeExtension(x, "obj")}`),
        warningLevel: 1,
        define: [],
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
            `cl.exe`,
            `/nologo`,
            `/Zi`,
            `/Fd${path.dirname(this.ruleTarget) + "/"}`,
            `/showIncludes`,
            `/W$(warningLevel)`,
            `/Zc:wchar_t`,
            `/FC`,
            ensureArray(this.define).map(x => `/d,${x}`),
            ensureArray(this.includePath).map(x => `/I,${x}`),
            this.config == "debug"
                ? [ "/D_DEBUG", "/Od", `/$(msvcrt)d` ] 
                : [ "/DNDEBUG", "/O2", "/Oi", `/$(msvcrt)` ],
            this.msvc_cl_args,
            pchFlags(),
            '/c', "$(ruleFirstDep)",
            `/Fo$(ruleTarget)`,
        ],
        opts: {
            env: captureMsvcEnvironment(),
            stdout: createStdoutFilter(),
        }
    })

    // Compile C Code
    this.rule({
        output: "$(objDir)/%.obj",
        deps: "$(sourceDir)/%.c",
        name: "compile",
        mkdir: true,
        subject: "$(ruleFirstDep)",
        needsBuild: checkHeaderDeps,
        action: compile,
    });

    // Compile C++ Code
    this.rule({
        output: "$(objDir)/%.obj",
        deps: "$(sourceDir)/%.cpp",
        name: "compile",
        mkdir: true,
        subject: "$(ruleFirstDep)",
        needsBuild: checkHeaderDeps,
        action: compile,
    });

    // Link (.exe or .dll)
    this.rule({
        output: "$(outputFile)",
        deps: () => pchSort(this.objFiles),
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
                this.ruleDeps,
                this.ruleTarget.endsWith(".exe") ? [] : [ "/DLL" ],
                this.msvc_link_args,
                `/out:$(ruleTarget)`,
                `/pdb:${changeExtension(this.ruleTarget, ".pdb")}`
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });

    // Create library (.lib)
    this.rule({
        output: "$(outputFile)",
        deps: () => this.objFiles,
        name: "lib",
        mkdir: true,
        condition: () => !!this.projectKind.match(/lib|a/),
        action: () => this.exec({
            cmdargs: [
                `@lib.exe`,
                `/nologo`,
                this.ruleDeps,
                this.msvc_lib_args,
                `/out:$(ruleTarget)`,
            ],
            opts: {
                env: captureMsvcEnvironment(),
            }
        })
    });

    this.rule({
        name: "build",
        deps: "$(outputFile)",
    });

    this.rule({
        name: "clean",
        action: "rm -rf $(buildDir)"
    });

    this.rule({
        name: "run",
        deps: "build",
        action: {
            cmdargs: "$(outputFile)",
            opts: { shell: false },
        },
        condition: () => this.projectKind == "exe",
    });

    // Sort object files so the pch source file is first
    // Required so the pch file is created before trying to use it
    function pchSort(objFiles)
    {
        let info = pchInfo();
        if (!info)
            return objFiles;

        let index = objFiles.indexOf(changeExtension(info.pchFile, "obj"));
        if (index < 0)
            throw new Error("Precompiled header object file not in list");
        if (index == 0)
            return objFiles;

        let result = objFiles.slice();
        result.unshift(...result.splice(index, 1));
        return result;
    }

    // Calculate the pch flags to use for the current compilation rule
    function pchFlags()
    {
        // Get PCH info
        let info = pchInfo();
        if (!info)
            return [];

        // Must be same file type (c or cpp)
        // A .pch file for a C++ file can't be used to precompile a C file
        // and vice versa
        if (path.extname(self.ruleFirstDep) != path.extname(info.sourceFile))
            return [];

        // Work out whether to "use" or "compile" pch file
        let isPchSource = path.resolve(info.sourceFile) == path.resolve(self.ruleFirstDep);
        let flag = isPchSource ? "c" : "u";

        // Use flags
        return [
            `/Y${flag}${info.headerFile}`,
            `/Fp${info.pchFile}`
        ];
        
    }

    // Get info about the precompiled header
    let _pchInfo;
    function pchInfo()
    {
        // Only do this once
        if (_pchInfo === undefined)
        {
            // Work out the source file to be used to generate the .pch file
            let pchSourceFile = self.pchSourceFile;
            if (!pchSourceFile)
            {
                for (let f of self.sourceFiles)
                {
                    let m = f.match(/(^|\/)(stdafx|precomp)\.(c|cpp)$/i);
                    if (m)
                    {
                        pchSourceFile = f;
                        break;
                    }
                }
            }

            if (!pchSourceFile)
            {
                // Not using precompiled headers
                _pchInfo = null;
            }
            else
                // Found it!
                _pchInfo = {
                    sourceFile: pchSourceFile,
                    headerFile: changeExtension(pchSourceFile, ".h"),
                    pchFile: self.objDir + "/" + changeExtension(pchSourceFile, ".pch"),
                }
        }

        return _pchInfo;
    }


    // Creates a filter to filter the stdout from cl.exe to
    // 1. filter out the source file name
    // 2. capture the names of included files produced by /showincludes and build a .d file
    //    that can be used for automatic header file generation.
    function createStdoutFilter() 
    {
        let deps = "";
        let filenameFiltered = false;
        let sourceFileResolved = null;
        return (line) => 
        {
            if (line == null)
            {
                // Finished, write .d file
                fs.writeFileSync(changeExtension(self.ruleTarget, ".d"), deps, "utf8");
            }
            else
            {
                // Capture included files
                if (line.startsWith("Note: including file:"))
                {
                    let file = line.substr(21).trim();

                    // Don't include system files
                    if (!file.startsWith("C:\\Program Files"))
                    {
                        deps += file + "\n";
                    }
                }
                else
                {
                    // Suppress printing name of source file
                    if (!filenameFiltered)
                    {
                        if (!sourceFileResolved)
                            sourceFileResolved = ospath.resolve(self.ruleFirstDep);
                        if (sourceFileResolved == ospath.resolve(line))
                        {
                            filenameFiltered = true;
                            return;
                        }
                    }

                    // Other output message
                    process.stdout.write(line + "\r\n");
                }
            }
        }
    }

    // Read a previously saved .d file and check if any of the dependent header files 
    // are newer than the target file
    function checkHeaderDeps()
    {
        try
        {
            // Get the time of the target
            let targetTime = self.mtime(self.ruleTarget);
            if (targetTime == 0)
                return true;

            // Read the .d file
            let deps = fs.readFileSync(changeExtension(self.ruleTarget, ".d"), "utf8").split("\n")

            // Check each dep
            for (let dep of deps)
            {
                // Ignore blank lines
                dep = dep.trim();
                if (dep == "")
                    continue;

                // Check time stamp
                let t = self.mtime(dep);
                if (t != 0 && t > targetTime)
                    return true;
            }
            return false;
        }
        catch
        {
            // The .d file not yet generated, don't care.
            return false;
        }
    }

}
