import { msvc } from './msvc.js';
import child_process from "node:child_process";
import url from "node:url";
import path from "node:path";

/*
// Create MSVC tool chain
var toolchain = new msvc();

// Run vcvars and capture resulting environment
let output = child_process.execSync(`cl`, 
{ 
    args: [ "/?" ],
    encoding: "utf-8",
    env: toolchain.env,
});

console.log(output);
*/

let mk = await import(url.pathToFileURL(path.resolve("./mk.js")).href);

let proj = {

    // Global variables used by this project and sub-projects
    globals: {},

    // Local variables only used by this project
    vars: {},

    // Rules for this project
    rules: [],
    rulesByName: {},

    // Define local variables
    define: function(vals)
    {
        Object.assign(this.vars, vals);
    },

    // Define local variables, but only if not already defined
    default: function(vals)
    {
        for (let key in vals) 
        {
            if (!Object.prototype.hasOwnProperty.call(this.vars, key)) 
            {
                this.vars[key] = vals[key];
            }
        }
    },

    // Register a rule for this project
    rule: function(rule)
    {
        // Named rule?
        if (rule.name)
        {
            if (this.rulesByName.hasOwnProperty(rule.name))
                throw new Error($`A rule '${rule.name}' already exists`);
            this.rulesByName[rule.name] = rule;
        }

        // Add to list of all rules
        this.rules.push(rule);
    },

    // Uses something else?
    use: function(item)
    {
        
    }
}

mk.default.call(proj);

console.log(proj.vars);
console.log(proj.rules);


