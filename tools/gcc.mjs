import fs from 'node:fs';
import { posix as path, default as ospath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatArray, changeExtension, splitEscapedSpaces } from "../utils.js";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

export default async function() {

    let self = this;

    // Load standard c vars and rules
    await this.use("./common-c.mjs");

    // Default variables
    this.default({
        toolchain: "gcc",
        platform: process.platform,
        gcc_prefix: "",
        gcc_c_standard: "c2x",
        gcc_cpp_standard: "c++17",
        gcc_as_args: [],
        gcc_common_args: [],
        gcc_c_args: [],
        gcc_cpp_args: [],
        gcc_libs: [],
        gcc_link_args: [],
        gcc_ar_args: [],

        gcc_warn_args: () => {
            // Approximately match msvc warning level to gcc warning groups
            let r = [];
            if (this.warningLevel >= 1)
                r.push( '-Wall' );
            if (this.warningLevel >= 2)
                r.push('-Wextra' );
            if (this.warningLevel >= 3)
                r.push('-Wpedantic');
            if (this.warningLevel >= 4)
                r.push('-Wconversion', '-Wsign-conversion', '-Wshadow');
            r.push("-Wno-unused-parameter")
            return r;
        },
        gcc_preproc_args: () => {
            return [
                ...flatArray(this.define).map(x => `-D${x}`),
                ...flatArray(this.includePath).map(x => `-I ${x}`),
            ]
        },
        gcc_config_args: () => {
            return this.config == "debug"
                ? [ "-g", "-D_DEBUG", "-O0" ] 
                : [ "-DNDEBUG", "-O2" ];
        },
        gcc_as_defaults: () => {
            return [
                ...this.gcc_preproc_args,
                ...this.gcc_config_args,
            ]
        },
        gcc_depgen_args: () => {
            return [
                `-MD`, 
                `-MF`, changeExtension(this.ruleTarget, "d"), 
                `-MT`, this.ruleTarget, 
                `-MP`, 
            ];
        },
        gcc_c_defaults: () => {
            return [
                ...this.gcc_preproc_args,
                ...this.gcc_config_args,
                ...this.gcc_warn_args,
                ...this.gcc_depgen_args,
                `--std=${this.gcc_c_standard}`,
            ]
        },
        gcc_cpp_defaults: () => {
            return [
                ...this.gcc_preproc_args,
                ...this.gcc_config_args,
                ...this.gcc_warn_args,
                ...this.gcc_depgen_args,
                `--std=${this.gcc_cpp_standard}`,
            ]
        },
        gcc_link_defaults: () => {
            return [
                this.projectKind == "exe" ? `-Wl,-rpath,'$ORIGIN'` : undefined,
                this.projectKind.match(/dll|so/) ? 
                    [ `-shared`, `-Wl,-soname,${path.basename(this.ruleTarget)}` ] : undefined
            ].filter(x => x !== undefined);
        },
        gcc_link_command: "g++",    
        asm_extensions: "s,S",
        objFiles: () => this.sourceFiles.map(x => `${this.objDir}/${changeExtension(x, "o")}`),
        linkLibrary: () => {
            switch (this.projectKind)
            {
                case "lib":
                case "a":
                case "so":
                case "dll":
                    return this.outputFile;
            }
            return undefined;
        },
        runtimeFiles: () => {
            switch (this.projectKind)
            {
                case "so":
                case "dll":
                case "exe":
                    return [ this.outputFile ];
            }
            return undefined;
        },
        outputName: () => {
            switch (this.projectKind)
            {
                case "exe": 
                    return this.projectName;

                case "so":
                case "dll":
                    return `lib${this.projectName}.so`;
                    
                case "lib":
                case "a":
                    return `lib${this.projectName}.a`;
            }
            throw new Error(`Unknown project kind: ${this.projectKind}.  Expected 'exe', 'so'/'dll' or 'lib'/'a'"`)
        }
    });

    // Assamble s and S
    let asmRule = {
        output: () => `${this.objDir}/%.o`,
        // deps: see below
        name: "assemble",
        mkdir: true,
        subject: () => this.ruleFirstDep,
        needsBuild: checkHeaderDeps,
        action: async () => {

            // Assemble file
            await this.exec([
                `${this.gcc_prefix}gcc`,
                this.gcc_as_defaults,
                this.gcc_as_args,
                `-o`, this.ruleTarget,
                `-c`, this.ruleFirstDep,
            ]);

            // Use C preprocessor to generate .d file
            await this.exec([
                `${this.gcc_prefix}cpp`,
                `-M`,
                `-MT`, this.ruleTarget,
                this.gcc_config_args,
                this.gcc_preproc_args,
                this.ruleFirstDep,
                ">", changeExtension(this.ruleTarget, "d")
            ]);

        },
    };
    this.rule(Object.assign({}, asmRule, { deps: () => `${this.sourceDir}/%.s` }));
    this.rule(Object.assign({}, asmRule, { deps: () => `${this.sourceDir}/%.S` }));

    // Compile C Code
    this.rule({
        output: () => `${this.objDir}/%.o`,
        deps: () => `${this.sourceDir}/%.c`,
        name: "compile",
        mkdir: true,
        subject: () => this.ruleFirstDep,
        needsBuild: checkHeaderDeps,
        action: () => this.exec([
            `${this.gcc_prefix}gcc`,
            this.gcc_common_args,
            this.gcc_c_defaults,
            this.gcc_c_args,
            `-o`, this.ruleTarget,
            `-c`, this.ruleFirstDep,
        ]),
    });

    // Compile C++ Code
    this.rule({
        output: () => `${this.objDir}/%.o`,
        deps: () => `${this.sourceDir}/%.cpp`,
        name: "compile",
        mkdir: true,
        subject: () => this.ruleFirstDep,
        needsBuild: checkHeaderDeps,
        action: () => this.exec([
            `${this.gcc_prefix}g++`,
            this.gcc_common_args,
            this.gcc_cpp_defaults,
            this.gcc_cpp_args,
            `-o`, this.ruleTarget,
            `-c`, this.ruleFirstDep,
        ]),
    });

    // Link (executable or so)
    this.rule({
        output: () => this.outputFile,
        deps: () => [this.objFiles, this.gcc_libs, this.subProjectLibs],
        name: "link",
        mkdir: true,
        enabled: () => !this.projectKind.match(/lib|a/),
        action: () => this.exec([
            `${this.gcc_prefix}${this.gcc_link_command}`,
            this.gcc_link_defaults,
            this.gcc_link_args,
            `-o`, this.ruleTarget,
            this.ruleDeps,
            `--start-group`,
            this.gcc_libs,
            this.subProjectLibs,
            `--end-group`
        ]),
    });

    // Create library (.lib)
    this.rule({
        output: () => this.outputFile,
        deps: () => this.objFiles,
        name: "ar",
        mkdir: true,
        enabled: () => !!this.projectKind.match(/lib|a/),
        action: () => this.exec([
            `${this.gcc_prefix}ar`,
            `cr`, 
            this.ruleTarget,
            this.ruleDeps,
            this.gcc_ar_args,
        ])
    });

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

            let resolvedTarget = self.resolve(self.ruleTarget);

            // Read the .d file
            let lines = fs.readFileSync(self.resolve(changeExtension(self.ruleTarget, ".d")), "utf8").split("\n")

            // Join backslash escaped lines
            for (let i=0; i<lines.length; i++)
            {
                let l = lines[i];
                if (l.endsWith("\\"))
                {
                    lines[i] = l.substring(0, l.length-1) + lines[i+1];
                    lines.splice(i + 1, 1);
                    i--;
                }
            }

            // Parse file
            for (let line of lines)
            {
                let parts = line.split(':', 2);
                if (parts.length == 2)
                {
                    let target = parts[0];
                    if (self.resolve(target) == resolvedTarget)
                    {
                        let deps = splitEscapedSpaces(parts[1]);
                        for (let dep of deps)
                        {
                            // Ignore blanks
                            dep = dep.trim();
                            if (dep == "")
                                continue;

                            // Check time stamp
                            let t = self.mtime(dep);
                            if (t != 0 && t > targetTime)
                                return true;
                        }
                    }
                }
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
