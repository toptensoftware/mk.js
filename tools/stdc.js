import { cache } from "../utils.js";

export default async function() {

    // Default variables
    this.default({
        config: "debug",
        sourceDir: ".",
        projectKind: "exe",
        buildRoot: "./build",
        buildDir: "$(buildRoot)/$(platform)/$(config)",
        objDir: "$(buildDir)/obj",
        outputDir: () => `$(buildDir)/${this.projectKind == 'lib' ? "lib" : "bin"}`,
        outputFile: "$(outputDir)/$(projectName).$(outputExtension)",
        sourceFiles: cache(() => this.glob("$(sourceDir)/*.{c,cpp}")),
        warningLevel: 1,
        define: [],
        includePath: [],
        linkLibrary: () => this.projectKind == 'lib' ? this.outputFile : undefined,
        subProjectLibs: () => Object.values(this.subProjects).map(x => this.relative(x.resolve(x.linkLibrary))),
    });

    // Build target
    this.rule({
        name: "build",
        deps: [ "build-sub-projects", "$(outputFile)" ],
    });

    this.rule({
        name: "build-sub-projects",
        action: async () => {
            for (let sp of Object.values(this.subProjects))
            {
                await sp.buildTarget("build");
            }
        }
    })

    // Clean target
    this.rule({
        name: "clean",
        deps: [ "clean-sub-projects" ],
        action: "rm -rf $(buildDir)"
    });

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
        action: {
            cmdargs: "$(outputFile)",
            opts: { shell: false },
        },
        condition: () => this.projectKind == "exe",
    });
}