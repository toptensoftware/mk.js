import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { posix as path, default as ospath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { toPosix, toWindows, flatArray, changeExtension } from "../utils.js";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

// Expand windows style environment variables
function expandEnvVars(str) {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || `%${key}%`);
}

// Work out default install location for msvc
let vcvars = null;
function resolveVcVarsLocation()
{
    if (vcvars)
        return vcvars;
    // Use vswhere to locate latest SVC install location
    let cmd = `"%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`
    let output = execSync(expandEnvVars(cmd), { 
            encoding: "utf-8" 
        });

    // Return path to vcvarsall
    return vcvars = ospath.join(output.trim(), "VC\\Auxiliary\\Build\\vcvarsall.bat");
}

let msvc_env = {};
let cache;
function captureMsvcEnvironment(platform)
{
    if (!platform) 
        platform = "x64";
    if (platform == "x64")
        platform = "x86_x64";

    if (msvc_env[platform])
        return msvc_env[platform];

    // Resolve location
    var vcvars = resolveVcVarsLocation();
    if (vcvars == null)
        throw new Error("Unable to resolve VC vars location");

    // Load cache
    // Because vsvarsall is pretty slow (up to a couple of second)
    // cache the results in our own cache file, keyed on a hash
    // of the current environment and the platform we're querying.
    let cache_file = path.join(os.tmpdir(), "mk.js.msvc-cache.json");
    if (!cache)
    {
        if (fs.existsSync(cache_file))
        {
            cache = JSON.parse(fs.readFileSync(cache_file, "utf8"));
        }     
        else
        {
            cache = {};
        }   
    }

    // Delete dynamic environment variables that might change every run
    let process_env = Object.assign({}, process.env);
    delete process_env["CHROME_CRASHPAD_PIPE_NAME"];
    delete process_env["IGCCSVC_DB"];
    delete process_env["WT_SESSION"];
    delete process_env["WT_PROFILE_ID"];
    delete process_env["VSCODE_INSPECTOR_OPTIONS"];

    // Calculate hash key
    let cache_hash = crypto.createHash('sha256')
        .update(JSON.stringify(process_env) + "--" + platform + "--" + vcvars).digest("hex");
    if (cache[platform] && cache[platform].hash == cache_hash)
    {
//        console.log("Using pre-cached MSVC environment");
        return msvc_env[platform] = cache[platform].env;
    }

    // Run it
    try 
    {
//        console.log("Determining MSVC environment");

        // Run vcvars and capture resulting environment
        let output = execSync(`"${vcvars}" ${platform} && echo --- ENV --- && set`, 
        { 
            encoding: "utf-8" 
        });

        // Get just the environment bit and split into lines
        output = output.split("--- ENV ---", 2)[1].replace("\r\n", "\n")
        let env = {};
        for (let line of output.split("\n"))
        {
            let parts = line.split("=", 2);
            if (parts.length == 2)
               env[parts[0]] = parts[1].trim();
        }

        // Done
        cache[platform] = { hash: cache_hash, env };
        fs.writeFileSync(cache_file, JSON.stringify(cache, null, 4), "utf8");
        return msvc_env[platform] = env;
    } 
    catch (error) 
    {
        throw new Error(`Unable to capture VC environment - ${error.message}`);
    }
}


export default async function() {

    let self = this;

    // Load standard c vars and rules
    await this.use("./common-c.mjs");

    // Default variables
    this.default({
        toolchain: "msvc",
        platform: "x64",
        asm_extensions: "asm",
        objFiles: () => this.sourceFiles.map(x => `${this.objDir}/${changeExtension(x, "obj")}`),
        msvcrt: "MD",
        msvc_libs: [],
        msvc_c_standard: () => this.c_standard,
        msvc_cpp_standard: () => this.cpp_standard,
        linkLibrary: () => {
            switch (this.projectKind)
            {
                case "lib":
                case "a":
                    return this.outputFile;

                case "so":
                case "dll":
                    return changeExtension(this.outputFile, "lib");
            }
            return undefined;
        },
        runtimeFiles: () => {
            switch (this.projectKind)
            {
                case "so":
                case "dll":
                case "exe":
                    return [ this.outputFile, changeExtension(this.outputFile, "pdb") ];
            }
            return undefined;
        },
        outputName: () => `${this.projectName}.${this.outputExtension}`,
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


    // Assemble
    this.rule({
        output: () => `${this.objDir}/%.obj`,
        deps: () => `${this.sourceDir}/%.asm`,
        name: "assemble",
        mkdir: true,
        subject: () => this.ruleFirstDep,
        needsBuild: checkHeaderDeps,
        action: () => this.exec({
            cmdargs: [
                this.platform == "x86" ? "ml.exe" : "ml64.exe",
                `/nologo`,
                `/Zi`,
                flatArray(this.define).map(x => `/D${x}`),
                flatArray(this.includePath).map(x => `/I${x}`),
                this.config == "debug"
                    ? [ "/D_DEBUG" ] 
                    : [ "/DNDEBUG"  ],
                this.platform == "x86" 
                    ? [ "/D_WIN32", `/coff` ]
                    : [ "/D_WIN64" ],
                this.msvc_ml_args,
                `/Fo${toWindows(this.ruleTarget)}`,
                `/c`, this.ruleFirstDep,
            ],
            opts: {
                env: captureMsvcEnvironment(this.platform),
                stdout: (line) => {
                    if (line && !line.match(/^\s*Assembling:/))
                        process.stdout.write(line + "\n");
                },
            }
        })
    });


    // Callback lambda to compile a c or c++ file
    let compile = () => this.exec({
        cmdargs: [
            `cl.exe`,
            `/nologo`,
            `/Zi`,
            `/Fd${path.dirname(this.ruleTarget) + "/"}`,
            `/showIncludes`,
            `/W${this.warningLevel}`,
            `/Zc:wchar_t`,
            `/FC`,
            `/std:${this.ruleFirstDep.endsWith(".c") ? this.msvc_c_standard : this.msvc_cpp_standard}`,
            flatArray(this.define).map(x => `/D${x}`),
            flatArray(this.includePath).map(x => `/I${x}`),
            this.config == "debug"
                ? [ "/D_DEBUG", "/Od", `/${this.msvcrt}d` ] 
                : [ "/DNDEBUG", "/O2", "/Oi", `/${this.msvcrt}` ],
            this.msvc_cl_args,
            //pchFlags(),
            '/c', this.ruleFirstDep,
            `/Fo${this.ruleTarget}`,
        ],
        opts: {
            env: captureMsvcEnvironment(this.platform),
            stdout: createStdoutFilter(),
        }
    })

    // Compile C Code
    this.rule({
        output: () => `${this.objDir}/%.obj`,
        deps: () => `${this.sourceDir}/%.c`,
        name: "compile",
        mkdir: true,
        subject: () => this.ruleFirstDep,
        needsBuild: checkHeaderDeps,
        action: compile,
    });

    // Compile C++ Code
    this.rule({
        output: () => `${this.objDir}/%.obj`,
        deps: () => `${this.sourceDir}/%.cpp`,
        name: "compile",
        mkdir: true,
        subject: () => this.ruleFirstDep,
        needsBuild: checkHeaderDeps,
        action: compile,
    });

    // Link (.exe or .dll)
    this.rule({
        output: () => this.outputFile,
        deps: () => [this.objFiles, this.msvc_libs, this.subProjectLibs],
        name: "link",
        mkdir: true,
        enabled: () => !this.projectKind.match(/lib|a/),
        action: () => this.exec({
            cmdargs: [
                `link.exe`,
                `/nologo`,
                `/DEBUG`,
                this.config == "debug"
                    ? [  ] 
                    : [ "/OPT:REF", "/OPT:ICF" ],
                this.libs,
                this.subProjectLibs,
                this.ruleDeps,
                this.ruleTarget.endsWith(".exe") ? [] : [ "/DLL" ],
                this.msvc_link_args,
                `/out:${this.ruleTarget}`,
                `/pdb:${changeExtension(this.ruleTarget, ".pdb")}`
            ],
            opts: {
                env: captureMsvcEnvironment(this.platform),
                stdout: (line) => {
                    if (line && !line.match(/^\s*Creating library/))
                        process.stdout.write(line + "\n");
                },
            }
        })
    });

    // Create library (.lib)
    this.rule({
        output: () => this.outputFile,
        deps: () => this.objFiles,
        name: "lib",
        mkdir: true,
        enabled: () => !!this.projectKind.match(/lib|a/),
        action: async () => {

            // Delete old library (if exists)
            await this.exec(['rm', '-f', this.ruleTarget]);

            // Create library
            await this.exec({
                cmdargs: [
                    `lib.exe`,
                    `/nologo`,
                    this.ruleDeps,
                    this.msvc_lib_args,
                    `/out:${this.ruleTarget}`,
                ],
                opts: {
                    env: captureMsvcEnvironment(this.platform),
                }
            });
            
        },
    });

/*

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
        // Disable PCH support - breaks /showIncludes
        return null;

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

*/

    // Creates a filter to filter the stdout from cl.exe to
    // 1. filter out the source file name
    // 2. capture the names of included files produced by /showincludes and build a .d file
    //    that can be used for automatic header file generation.
    function createStdoutFilter() 
    {
        let deps = "";
        let filenameFiltered = false;
        let sourceFileResolved = null;
        let currentDrive = process.cwd()[0];
        return (line) => 
        {
            if (line == null)
            {
                // Finished, write .d file
                fs.writeFileSync(path.resolve(self.projectDir, changeExtension(self.ruleTarget, ".d")), deps, "utf8");
            }
            else
            {
                // Capture included files
                if (line.startsWith("Note: including file:"))
                {
                    let file = line.substr(21).trim();

                    // Don't include files on other drives (confuses posix paths)
                    if (file[0] == currentDrive)
                    {
                        // Don't include system files
                        if (!file.startsWith("C:\\Program Files"))
                        {
                            // Convert to posix style relative path from project
                            let rel = toPosix(ospath.relative(toWindows(self.projectDir), file));
                            //let rel = self.relative(toPosix(file));

                            // Convert to a relative path
                            deps += rel + "\n";
                        }
                    }
                }
                else
                {
                    // Suppress printing name of source file
                    if (!filenameFiltered)
                    {
                        if (!sourceFileResolved)
                            sourceFileResolved = ospath.basename(self.ruleFirstDep);
                        if (sourceFileResolved == line)
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
            let deps = fs.readFileSync(self.resolve(changeExtension(self.ruleTarget, ".d")), "utf8").split("\n")

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
