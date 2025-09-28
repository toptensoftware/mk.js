import { cache, changeExtension } from "../utils.js";
import { posix as path, default as ospath } from 'node:path';

export default async function() {

    // Default variables
    this.default({
        config: "debug",
        sourceDir: ".",
        projectKind: "exe",
        buildRoot: "./build",
        buildDir: () => `${this.buildRoot}/${this.platform}/${this.config}`,
        objDir: () => `${this.buildDir}/obj`,
        outputDir: () => `${this.buildDir}/${this.projectKind == 'lib' ? "lib" : "bin"}`,
        outputFile: () => `${this.outputDir}/${this.outputName}`,
        sourceFiles: cache(() => this.glob(`${this.sourceDir}/*.{c,cpp,${this.asm_extensions}}`)),
        warningLevel: 3,
        define: [],
        includePath: [],
        subProjectLibs: () => Object.values(this.subProjects)
                                .filter(x => !!x.linkLibrary)
                                .map(x => this.relative(x.resolve(x.linkLibrary))),
        subProjectRuntimeFiles: () => Object.values(this.subProjects)
                                .filter(x => !!x.runtimeFiles)
                                .map(x => x.runtimeFiles.map(y => this.relative(x.resolve(y))))
                                .flat(Infinity),
    });

    // Build target
    this.rule({
        name: "build",
        deps: () => [ 
            "build-sub-projects", 
            this.outputFile, 
            "copy-sub-project-runtimes" 
        ],
    });

    // Build sub-projects target
    this.rule({
        name: "build-sub-projects",
        action: async () => {
            for (let sp of Object.values(this.subProjects))
            {
                await sp.buildTarget("build");
            }
        }
    })

    // Copy sub-projects runtimes
    this.rule({
        name: "copy-sub-project-runtimes",
        action: async () => {
            let outdir = path.dirname(this.resolve(this.outputFile));
            let files = this.subProjectRuntimeFiles.filter(x => path.dirname(this.resolve(x)) != outdir);
            if (files.length)
            {
                await this.exec(['cp', '-u', ...files, this.relative(outdir) + "/"]);
            }
        }
    })

    // Clean target
    this.rule({
        name: "clean",
        deps: "clean-sub-projects",
        action: () => `rm -rf ${this.buildDir}`
    });

    // Clean Sub Projects target
    this.rule({
        name: "clean-sub-projects",
        action: async () => {
            for (let sp of Object.values(this.subProjects))
            {
                await sp.buildTarget("clean");
            }
        }
    })

    // Run target
    this.rule({
        name: "run",
        deps: "build",
        action: () => ({
            cmdargs: [ this.outputFile ],
            opts: { shell: false },
        }),
        condition: () => this.projectKind == "exe",
    });
}