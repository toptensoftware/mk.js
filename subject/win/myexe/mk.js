export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Define variables
    this.define({
        config: "debug",
        objFiles: [ "$(objdir)/test.obj" ],
        projectKind: "exe",
    });

    this.rule({
        output: "default",
        input: "$(outputFile)",
    });
};
