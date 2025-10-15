import { cache } from "../utils.js";

export default async function() {

    await this.use("./build-sub-projects.mjs");

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
        sourceFiles: cache(() => this.glob(
            `*.{c,cpp,${this.asm_extensions}}`,
            { cwd: this.sourceDir }
        )),
        warningLevel: 3,
        define: [],
        includePath: [],
        c_standard: "c2x",
        cpp_standard: "c++17",
        subProjectLibs: () => this.subProjects
                                .filter(x => !!x.linkLibrary)
                                .map(x => this.relative(x.resolve(x.linkLibrary))),
        subProjectRuntimeFiles: () => this.subProjects
                                .filter(x => !!x.runtimeFiles)
                                .map(x => x.runtimeFiles.map(y => this.relative(x.resolve(y))))
                                .flat(Infinity),
    });

    // Build target
    this.rule({
        name: "build",
        deps: () => [ 
            this.outputFile, 
            "copy-sub-project-runtimes" 
        ],
    });

    // Clean target
    this.rule({
        name: "clean",
        action: () => `rm -rf ${this.buildDir}`
    });

    // Run target
    this.rule({
        name: "run",
        deps: "build",
        action: () => ({
            cmdargs: [ this.outputFile ],
            opts: { shell: false },
        }),
        enabled: () => this.projectKind == "exe",
    });
}