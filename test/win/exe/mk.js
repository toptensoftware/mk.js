export default function()
{
    this.vars.kind = "exe",
    this.vars.name = "test",

    this.define({ 
        kind: "exe",
        name: "test",
    });

    this.default({
        objFiles: () => this.glob("*.c;*.cpp").map(x => `$(intdir)/${path.basename(x)}.obj`),
    });

/*
    this.use("$(toolchain)");
*/

    this.rule({
        target: "$(intdir)/*.obj",
        source: "$1.c",
        depends: () => this.readDeps("$(intdir)/$1.d"),
        action: [
            "cl $(source) -o $(target)",
        ]
    });
}
