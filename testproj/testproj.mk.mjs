export default async function ()
{
    // MSVC tool chain
    await this.use("c-cpp");

    // Load sub-projects from immediate sub-directories
    await this.loadAllSubProjects();

    // Set variables
    this.set({
        projectKind: "exe",
        execTest: () => this.shell("echo Hello World"),
    });
};
