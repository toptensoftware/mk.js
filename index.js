import url from "node:url";
import { posix as path } from "node:path";
import { globSync } from "glob";
import { resolve, quotedJoin } from "./utils.js";
    
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let mkfile = path.resolve("./mk.js");
let mk = await import(url.pathToFileURL(mkfile).href);

let globals = {
    config: "debug",
    action: "build",
}

let proj = {

    // Global variables used by this project and sub-projects
    globals: globals,

    // Local variables only used by this project
    vars: {
        mkfile: mkfile,
        home: path.dirname(mkfile),
    },

    // Rules for this project
    rules: [],

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
        // Add to list of all rules
        this.rules.push(rule);
    },

    // Uses something else?
    use: async function(item)
    {
        // Call function
        if (typeof(item) === 'function')
        {
            item = await item.call(this);
            if (item === undefined)
                return;
        }

        if (typeof(item) !== 'string')
            throw new Error("use() requires a string or callback that resolves to a string");

        // Load the module
        let loadPath;
        if (item.startsWith("."))
        {
            // Load relative to project
            loadPath = path.join(this.home, item);
        }
        else
        {
            // Load from tools directory
            loadPath = path.join(__dirname, "tools", item + ".js");
        }

        // Call it
        var module = await import(url.pathToFileURL(loadPath).href);
        module.default.call(this);
    },

    glob(pattern, options)
    {
        let opts = Object.assign({
            cwd: this.vars.home,
            posix: true,
        }, options);

        pattern = this.expand(pattern);

        return globSync(pattern, opts);
    },

    // Resolve a value by invoking callback functions and flattening arrays
    flatten(obj)
    {
        // Callback
        if (typeof(obj) === 'function')
            obj = obj.call(this);

        // Recursively flatten and callback arrays
        if (Array.isArray(obj))
        {
            let result = [];
            for (let i=0; i<obj.length; i++)
            {
                if (obj[i] === null || obj[i] === undefined)
                    continue;

                let mapped = this.flatten(obj[i]);
                if (Array.isArray(mapped))
                    result.push(...mapped);
                else
                    result.push(mapped);
            }
            return result;
        }

        // Result
        return obj;
    },

    _resolving: new Set(),

    // Resolve a variable to a string
    resolve(varname)
    {
        // Check for circular names
        if (this._resolving.has(varname))
            throw new Error(`Circular reference resolving variable '${varname}'`);
        this._resolving.add(varname);

        try
        {
            // Resolve variable
            let val = undefined;
            if (this.vars.hasOwnProperty(varname))
                val =  this.vars[varname];
            else if (this.globals.hasOwnProperty(varname))
                val = this.globals[varname];
            else if (process.env.hasOwnProperty(varname))
                val = process.env[varname];

            // Flatten the value
            val = this.flatten(val);

            // Resolve and join array values
            if (Array.isArray(val))
            {
                return val.map(x => this.expand(x));
            }
            else
            {
                return this.expand(val);
            }
        }
        finally
        {
            this._resolving.delete(varname);
        }
    },

    // Resolve a string expression, or an array of string expressions
    expand(expr)
    {
        if (expr === undefined || expr === null)
            return "";

        return resolve(expr, (varname) => quotedJoin(this.resolve(varname)));
    },

    findRule(nameOrTarget)
    {
        // Look for rule by name
        for (let i=0; i<this.rules.length; i++)
        {
            if (this.rules[i].name == nameOrTarget)
                return this.rules[i];
        }

        // Look for rule by target
        for (let i=0; i<this.rules.length; i++)
        {
            if (this.rules[i].target == nameOrTarget)
                return this.rules[i];
        }

        // No matching rule, try to infer one
        for (let i=0; i<this.rules.length; i++)
        {
            let inferredRules = [];
            var inferRule = this.inferRule(this.rules[i], nameOrTarget);
        }


    },

    inferRule(rule, nameOrTarget)
    {
    }
}

await mk.default.call(proj);



