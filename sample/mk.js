// Project entry point
export default async function()
{
    // Define some variables
    this.set({
        outputFile: "test.txt",
        greeting: "Hello",
        subject: "World",
        message: () => `${this.greeting} ${this.subject}`,
    });

    // File rule creates a file if it doesn't exist
    this.rule({
        output: () => this.outputFile,
        action: () => `echo ${this.message} > ${this.outputFile}`,
    });

    // Named rule "build"
    this.rule({
        name: "build",
        deps: () => this.outputFile,
    });

    // Named rule "clean"
    this.rule({
        name: "clean",
        action: () => `rm -f ${this.outputFile}`,
    });
}
