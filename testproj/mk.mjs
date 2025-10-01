export default async function ()
{
    // MSVC tool chain
    await this.use("c-cpp");

    // Load sub-projects
    await this.loadSubProject("static-lib");
    await this.loadSubProject("shared-lib");

    // Set variables
    this.set({
        projectKind: "exe",
        execTest: () => this.shell("echo Hello World"),
    });
};
