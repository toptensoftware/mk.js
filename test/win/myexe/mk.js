import { msvc } from "#mk";

export default async function()
{
    this.use(msvc);
    this.vars.projectKind = "lib";

    this.vars.test = () => [ 'a', 'b', 'c'];
    this.vars.other = [ 'x', 'y', 'z'];
    this.vars.result = [ this.vars.test, this.vars.other ];
    this.vars.defines = [ "_UNICODE", "_WINDOWS" ];
    this.vars.includePath = [ "../blah", "../$(objdir)/whatever" ]

    console.log(this.expand("$(objectFiles)"));
}
