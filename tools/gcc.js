import fs from 'node:fs';
import { posix as path, default as ospath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatArray, changeExtension, splitEscapedSpaces } from "../utils.js";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

export default async function() {

    let self = this;

    // Load standard c vars and rules
    await this.use("./common-c.js");

    // Default variables
    this.default({
        platform: process.platform,
        gcc_prefix: "",
        gcc_args: [ 
            '-g',
            '-fPIC'
        ],
        gcc_warn_args: () => {
            // Approximately match msvc warning level to gcc warning groups
            switch (this.warningLevel)
            {
                case 1:
                    return [ '-Wall' ];
                case 2:
                    return [ '-Wall', '-Wextra' ];
                case 3:
                    return [ '-Wall', '-Wextra', '-Wpedantic' ];
                case 4:
                    return [ '-Wall', '-Wextra', '-Wpedantic', '-Wconversion', '-Wsign-conversion', '-Wshadow' ];
            }
            return [];
        },
        gcc_c_standard: "c2x",
        gcc_as_args: [],
        gcc_c_args: [],
        gcc_cpp_args: [],
        gcc_link_args: [],
        gcc_ar_args: [],
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
                this.config == "debug"
                    ? [ "-D_DEBUG" ] 
                    : [ "-DNDEBUG" ],
                this.gcc_args,
                this.gcc_warn_args,
                this.gcc_as_args,
                flatArray(this.define).map(x => `-D${x}`),
                flatArray(this.includePath).map(x => `-I ${x}`),
                `-o`, this.ruleTarget,
                `-c`, this.firstRuleDep,
            ]);

            // Use C preprocessor to generate .d file
            await this.exec([
                `${this.gcc_prefix}cpp`,
                `-M`,
                `-MT`, this.ruleTarget,
                this.config == "debug"
                    ? [ "-D_DEBUG" ] 
                    : [ "-DNDEBUG" ],
                flatArray(this.define).map(x => `-D${x}`),
                flatArray(this.includePath).map(x => `-I ${x}`),
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
            this.config == "debug"
                ? [ "-D_DEBUG", "-O0" ] 
                : [ "-DNDEBUG", "-O2" ],
            this.gcc_args,
            this.gcc_warn_args,
            this.gcc_c_args,
            flatArray(this.define).map(x => `-D${x}`),
            flatArray(this.includePath).map(x => `-I ${x}`),
            `--std=${this.gcc_c_standard}`,
            `-MD`, `-MF`, changeExtension(this.ruleTarget, "d"), `-MT`, this.ruleTarget, `-MP`, 
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
            this.config == "debug"
                ? [ "-D_DEBUG", "-O0" ] 
                : [ "-DNDEBUG", "-O2" ],
            this.gcc_args,
            this.gcc_warn_args,
            this.gcc_cpp_args,
            flatArray(this.define).map(x => `-D${x}`),
            flatArray(this.includePath).map(x => `-I ${x}`),
            `-MD`, `-MF`, changeExtension(this.ruleTarget, "d"), `-MT`, this.ruleTarget, `-MP`, 
            `-o`, this.ruleTarget,
            this.ruleFirstDep,
        ]),
    });

    // Link (executable or so)
    this.rule({
        output: () => this.outputFile,
        deps: () => this.objFiles,
        name: "link",
        mkdir: true,
        condition: () => !this.projectKind.match(/lib|a/),
        action: () => this.exec([
            `${this.gcc_prefix}g++`,
            this.gcc_link_args,
            () => this.projectKind == "exe" ? `-Wl,-rpath,'$ORIGIN'` : undefined,
            this.projectKind.match(/dll|so/) ? 
                [ `-shared`, `-Wl,-soname,${path.basename(this.ruleTarget)}` ] :
                [],
            `-o`, this.ruleTarget,
            this.ruleDeps,
            this.libs,
            this.subProjectLibs,
        ]),
    });

    // Create library (.lib)
    this.rule({
        output: () => this.outputFile,
        deps: () => this.objFiles,
        name: "lib",
        mkdir: true,
        condition: () => !!this.projectKind.match(/lib|a/),
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
