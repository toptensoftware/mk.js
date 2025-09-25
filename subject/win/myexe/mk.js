export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Define variables
    this.define({
        config: "debug",
        projectKind: "exe",
    });

    this.rule({
        output: "default",
        input: "$(outputFile)",
    });
};
