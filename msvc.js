import fs from 'node:fs';
import child_process from 'node:child_process';

function expandEnvVars(str) {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || `%${key}%`);
}

function resolveMsvcLocation()
{
    // Look for vcvars
    let paths = [
        "%PROGRAMFILES%\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat",
        "%PROGRAMFILES(x86)%\\Microsoft Visual Studio\\2019\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat",
    ];

    for (let p of paths)
    {
        let expanded = expandEnvVars(p);
        if (fs.existsSync(expanded))
            return expanded;
    }

    return null;
}


export class msvc
{
    #env = null

    get env()
    {
        if (!this.#env)
        {
            // Resolve location
            var vcvars = resolveMsvcLocation();
            if (vcvars == null)
                throw new Error("Unable to resolve VC vars location");

            // Run it
            try 
            {
                // Run vcvars and capture resulting environment
                let output = child_process.execSync(`"${vcvars}" x86_x64 && echo --- ENV --- && set`, 
                { 
                    encoding: "utf-8" 
                });

                // Get just the environment bit and split into lines
                output = output.split("--- ENV ---", 2)[1].replace("\r\n", "\n")

                this.#env = {};
                for (let line of output.split("\n"))
                {
                    let parts = line.split("=", 2);
                    if (parts.length == 2)
                        this.#env[parts[0]] = parts[1];
                }
            } 
            catch (error) 
            {
                throw new Error(`Unable to capture VC environment - ${error.message}`);
            }
        }

        return this.#env;
    }
}
