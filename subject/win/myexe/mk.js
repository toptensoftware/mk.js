export default async function ()
{
    // MSVC tool chain
    await this.use("msvc");

    // Define variables
    this.define({
        config: "debug",
    });

    this.rule({
        output: "$(outdir)/test.exe",
        input: "$(objdir)/test.obj",
        action: "touch test.exe",
    });

    this.rule({
        output: "default",
        input: "$(outputFile)",
    });
};
