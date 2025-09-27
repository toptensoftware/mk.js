import { fileURLToPath } from 'node:url';
import { posix as path, default as ospath } from "node:path";
import { Project } from "./Project.js";
import { clargs, showPackageVersion, showArgs } from "@toptensoftware/clargs";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

let mkfile = ".";
let mkopts = { 
    set: {},
    globals: {},
    libPath: [],
};
let targets = [];
let args = clargs();
while (args.next())
{
    switch (args.name)
    {
        case "v":
        case "version":
            showVersion();
            process.exit(0);
            break;

        case "h": 
        case "help":
            // -h or --help
            showHelp();
            process.exit(0);
            break;

        case "debug":
            mkopts.verbosity = 9;
            break;

        case "quiet":
            mkopts.verbosity = 0;
            break;

        case "verbose":
            mkopts.verbosity = 2;
            break;

        case "verbosity":
            mkopts.verbosity = args.readIntValue();
            break;

        case "file":
            mkfile = args.readValue();
            break;

        case "dir":
            mkopts.dir = args.readValue();
            break;

        case "lib":
            mkopts.libPath.push(args.readValue());
            break;

        case "rebuild":
            mkopts.rebuild = true;
            break;

        case "vars":
            mkopts.vars = true;
            break;

        case "dryrun":
            mkopts.dryrun = true;
            break;

        case null:
            let parts = args.readValue().split("=");
            if (parts.length ==  2)
            {
                if (parts[0][0] == '.')
                {
                    // Local variable assignment
                    mkopts.set[parts[0].substring(1)] = parts[1];
                }
                else
                {
                    // Global variable assignment
                    mkopts.globals[parts[0]] = parts[1];
                }
            }
            else
            {
                // unnamed arg eg: file.txt
                targets.push(parts[0]);
            }
            break;

        default:
            throw new Error(`unknown arg: ${args.name}`);        
    }
}

try
{
    // Load project
    let proj = await Project.load(mkfile, mkopts);

    // Build targets
    if (targets.length == 0)
        targets = [ "build" ]
    await proj.buildTargets(targets);
}
catch (err)
{
    if (err.info)
    {
        process.stderr.write(err.message + "\n");
        process.exit(7);
    }
    else
        throw err;
}


function showVersion()
{
    showPackageVersion(path.join(__dirname, "package.json"));
}

function showHelp()
{
    showVersion();
    console.log("");
    console.log("usage: mk [options...] [targets...]\n");
    showArgs({
        "targets": "One or more target rules to run (defaults to \"build\")",
        "--file:<file>": "Path to mk.js script file to run",
        "--dir:<dir>": "Root directory to run the script under",
        "--lib:<dir>": "Adds a directory to search for library files loaded by use()",
        "--rebuild": "Rebuilds everything, ignoring dependency checkes",
        "--dryrun": "Runs the script but doesn't actually run any external commands",
        "--quiet": "Same as --verbosity:0",
        "--verbose": "Same as --verbosity:2",
        "--debug": "Same as --verbosity:9",
        "--verbosity:<level>": "Verbosity level",
        "-h,--help": "Show this help",
        "-v,--version": "Show version information",
    });
}