export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Set variables
    this.set({
        buildRoot: "../build",
        projectKind: "lib",
    });
};
