import { posix as path, default as ospath } from 'node:path';

export default async function()
{
    // Build rule
    this.rule({
        name: "build",
        order: -100,
        deps: "build-sub-projects",
    })

    // Build sub-projects rule
    this.rule({
        name: "build-sub-projects",
        action: async () => {
            for (let sp of this.subProjects)
            {
                await sp.make("build");
            }
        }
    })

    // Clean rule
    this.rule({
        name: "clean",
        order: -100,
        deps: "clean-sub-projects",
    })

    // Clean Sub Projects rule
    this.rule({
        name: "clean-sub-projects",
        action: async () => {
            for (let sp of this.subProjects)
            {
                await sp.make("clean");
            }
        }
    })

    // Copy sub-projects runtimes rule
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


}