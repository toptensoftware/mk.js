export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Load and build sub-project
    await this.loadSubProject("mylib");

    // Set variables
    this.set({
        projectKind: "exe",
    });
};
