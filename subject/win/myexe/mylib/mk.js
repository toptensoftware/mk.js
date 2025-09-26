export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Set variables
    this.set({
        buildDir: "../build/$(projectName)",
        config: "debug",
        projectKind: "lib",
    });
};
