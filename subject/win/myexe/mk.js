export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Load and build sub-project
    let subProject = await this.loadSubProject("mylib");
    await subProject.buildTarget("build");

    // Set variables
    this.set({
        buildDir: "./build/$(projectName)",
        config: "debug",
        projectKind: "exe",
    });
};
