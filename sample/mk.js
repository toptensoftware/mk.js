// Project entry point
export default async function()
{
    // Define some variables
    this.set({
        outputFile: "test.txt",
        greeting: "Hello World",
    });

    // File rule create a file if it doesn't exist
    this.rule({
        output: "$(outputFile)",
        action: "echo $(greeting) > $(outputFile)",
    });

    // Named rule "build"
    this.rule({
        name: "build",
        deps: [ "$(outputFile)" ],
    });

    // Named rule "clean"
    this.rule({
        name: "clean",
        action: "rm $(outputFile)"
    });
}
