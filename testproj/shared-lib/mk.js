export default async function ()
{
    // MSVC tool chain
    await this.use("c-cpp");

    // Set variables
    this.set({
//        buildRoot: "../build",
        projectKind: "so",
    });
};
