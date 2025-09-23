import { fileURLToPath } from 'node:url';
import { fileTime, resolve, quotedJoin, escapeRegExp, toArray, toBool, toString } from "./utils.js";

export class Project
{
    constructor()
    {
    }

    // Global variables used by this project and sub-projects
    globals = {};

    // Local variables only used by this project
    vars =  {}

    // Rules for this project
    fileRules = [];
    namedRules = new Map();

    // Load root level mk file
    async load(mkfile)
    {
        // Check not already loaded
        if (this.vars.mkfile)
            throw new Error("Project already loaded");

        // Import mk script
        let absmkfile = path.resolve("./mk.js");

        // Setup project variables
        this.vars.mkfile = absmkfile;
        this.vars.projdir = path.dirname(absmkfile);
        this.vars.projname = path.basename(this.vars.home);

        // Load and call module
        let module = await import(url.pathToFileURL(absmkfile).href);
        module.default.call(this);
    }

    // Define local variables
    define(vals)
    {
        Object.assign(this.vars, vals);
    }

    // Define local variables, but only if not already defined
    default(vals)
    {
        for (let key in vals) 
        {
            if (!Object.prototype.hasOwnProperty.call(this.vars, key)) 
            {
                this.vars[key] = vals[key];
            }
        }
    }

    // Register a rule for this project
    rule(rule)
    {        
        // Rules must have either a name or an input pattern
        if (!rule.name && !rule.output)
            throw new Error("Rule must have either name or output");

        // Add to list
        if (rule.output)
        {
            this.fileRules.push(rule);
        }
        else
        {
            if (this.namedRules.has(rule.name))
                throw new Error(`A named rule '${rule.name}' already defined`);

            this.namedRules.set(rule.name, rule);
        }

        // Make sure input is set and is an array
        if (!rule.input)
            rule.input = [];
        else if (!Array.isArray(rule.input))
            rule.input = [rule.input];

        // Null out empty actions
        if (rule.action)
        {
            // Ensure array
            if (!Array.isArray(rule.action))
                rule.action = [rule.action];

            // Filter out no-op actions
            rule.action = rule.action.filter(x => {
                if (x === null || x === undefined)
                    return false;
                if (typeof(x) === 'string')
                    return x.trim() != "";
                return x;
            });

            // Clear if no actions
            if (rule.action.length === 0)
                rule.action = null;
        }

        // Capture location
        /*
        const stack = new Error().stack
            .split('\n')
            .slice(2) // remove the "Error" and this function
            [0].trim();
        let m = stack.match(/^(?:at )(.*) \((.*)\)/)
        let fn = m ? m[1] : "<unknown>";  
        let src = m ? m[2] : "<unknown>"; 
        if (src.startsWith("file:///"))
            src = fileURLToPath(src);  
        rule.location = { src, fn, }
        */

        // Capture location of rule definition
        rule.stack = (new Error()).stack;
    }

    // Uses something else?
    async use(item)
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
        let module = await import(url.pathToFileURL(loadPath).href);
        module.default.call(this);
    }

    // Perform a glob operation relative to the project home
    glob(pattern, options)
    {
        let opts = Object.assign({
            cwd: this.vars.home,
            posix: true,
        }, options);

        pattern = this.evalString(pattern);

        return globSync(pattern, opts);
    }

    // eval a value by invoking callback functions, and flattening arrays and
    // expanding strings
    eval(obj)
    {
        if (obj === null || obj === undefined)
            return obj;

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

                let mapped = this.eval(obj[i]);
                if (Array.isArray(mapped))
                    result.push(...mapped);
                else
                    result.push(mapped);
            }
            return result;
        }

        if (typeof(obj) === 'string')
            return this.expand(obj);

        // Result
        return obj;
    }

    evalString(obj)
    {
        return toString(this.eval(obj));
    }

    evalArray(obj)
    {
        return toArray(this.eval(obj));
    }

    evalBool(obj)
    {
        return toBool(this.eval(obj));
    }

    // Variables currently being resolved (to detect circular references)
    _resolving = new Set();

    // Resolve and eval a variable name to its value
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

            if (this.currentRule != null)
            {
                // Note: currentRule variables are already expanded
                switch (varname)
                {
                    case "output":
                        return this.currentRule.output;
                    case "input":
                        return this.currentRule.input;
                    case "firstInput":
                        return this.currentRule.input.length > 0 ? this.currentRule.input[0] : null;
                    case "unqiueInput":
                        return [...new Set(this.currentRule.input)];
                }
            }

            if (this.vars.hasOwnProperty(varname))
                val =  this.vars[varname];
            else if (this.globals.hasOwnProperty(varname))
                val = this.globals[varname];
            else if (process.env.hasOwnProperty(varname))
                val = process.env[varname];

            // eval the value
            return this.eval(val);
        }
        finally
        {
            this._resolving.delete(varname);
        }
    }

    resolveBool(varname)
    {
        return toBool(this.resolve(varname));
    }

    resolveArray(varname)
    {
        return toArray(this.resolve(varname));
    }   

    resolveString(varname)
    {
        return toString(this.resolve(varname));
    }

    // Resolve a string expression, or an array of string expressions
    expand(expr)
    {
        if (typeof(expr) !== 'string')
            return expr;
        return resolve(expr, (varname) => quotedJoin(this.resolve(varname)));
    }

    // Find all rules that can produce a given file
    // filename should be fully expanded
    findFileRules(filename)
    {
        let rules = [];

        // Look for explicit ruls
        let haveAction = false;
        let haveInferredRules = false;
        for (let rule of this.fileRules)
        {
            // Match input pattern
            let pattern = this.evalString(rule.output);

            if (pattern.indexOf("%") < 0 && pattern === filename)
            {
                rules.push(rule);
                if (rule.action)
                    haveAction = true;
            }
            else
                haveInferredRules = true;
        }

        // If have an action, don't use inferred rules
        if (haveAction || !haveInferredRules)
            return rules;

        // Create inferred rules
        for (let rule of this.fileRules)
        {
            // Match input pattern
            let pattern = this.evalString(rule.output);

            // Inferred rules?
            if (pattern.indexOf("%") >= 0)
            {
                let regex = new RegExp("^" + escapeRegExp(pattern).replace(/\%/g, "(.+)") + "$");
                let m = regex.exec(filename);
                if (!m)
                    continue;
                    
                // Matched - infer rule
                let inferred;
                if (rule.infer)
                {
                    // Call infer function to generate new rule
                    inferred = rule.infer(m[1], this);
                }
                else
                {
                    // Infer rule from pattern
                    inferred = {
                        output: filename,
                        input: this.evalArray(rule.input).map(x => toString(x).replace(/\%/g, () => m[1])),
                        action: rule.action,
                    }
                }

                // Add to list
                if (inferred)
                {
                    inferred.inferredFrom = rule;
                    rules.push(inferred);
                }
            }
        }

        return rules;
    }

    // Get the modification time of a file, or 0 if it doesn't exist
    // Override for mock file testing
    // filename should be expanded
    mtime(filename)
    {
        return fileTime(filename);
    }

    // Can this project build a file?
    // Either has a rule, or the file exists
    // filename should be expanded
    canBuild(filename)
    {
        var rules = this.findFileRules(filename);
        if (rules.length > 0)
            return true;
        return this.mtime(filename) != 0;
    }

    // Generate a plan to make a file
    builtFiles = new Set();
    async buildFile(filename)
    {
        let self = this;

        // Eval the filename
        filename = this.evalString(filename);

        // If file has already been build, then don't need to redo it
        if (this.builtFiles.has(filename))
            return;
        this.builtFiles.add(filename);

        // Find rules for this file
        let rules = this.findFileRules(filename);

        // The final MRule ("merged rule")
        let finalMRule = {
            output: filename,
            action: null,
            input: [],
            rules: [],
        };

        function copyMRule(mrule)
        {
            return {
                output: mrule.output,
                action: mrule.action,
                input: mrule.input.slice(),
                rules: mrule.rules.slice(),
            };
        }

        function addRule(mrule, rule)
        {
            // Only one rule can have an action
            if (rule.action)
            {
                if (mrule.action)
                    throw new Error(`Multiple rules define build actions for file '${filename}'`);
                mrule.action = rule.action;

                // Combine inputs
                // Action rule inputs go at the start
                mrule.input.unshift(...rule.input.map(x => self.eval(x)));
            }
            else
            {
                // Combine inputs
                // Non-action rule inputs go at the end
                mrule.input.push(...rule.input.map(x => self.eval(x)));
            }

            // Add to list of sub rules
            mrule.rules.push(rule);
        }

        // Start with explicit rules
        for (let rule of rules)
        {
            if (!rule.inferredFrom)
            {
                addRule(finalMRule, rule);
            }
        }

        // If no action, check for inferred rules
        if (!finalMRule.action)
        {
            // Merge all inferred rules that don't have an action
            for (let rule of rules)
            {
                if (rule.inferredFrom && !rule.action)
                {
                    addRule(finalMRule, rule);
                }
            }

            // Now try each inferred rule that has an action
            let candidateRules = [];
            for (let rule of rules)
            {
                if (rule.inferredFrom && rule.action)
                {
                    let inferredMRule = copyMRule(finalMRule);
                    addRule(inferredMRule, rule);

                    if (inferredMRule.input.every(x => self.canBuild(x)))
                    {
                        candidateRules.push(inferredMRule);
                    }
                }
            }

            if (candidateRules.length == 1)
            {
                finalMRule = candidateRules[0];
            }
            else if (candidateRules.length > 1)
            {
                throw new Error(`Multiple inferred rules match file '${filename}'`);
            }
        }

        // If rules for this file, then check it exists
        if (finalMRule.rules.length)
        {
            if (this.mtime(filename) == 0)
            {
                throw new Error(`No rule to make file '${filename}'`);
            }
            return;
        }

        // Build all inputs
        for (let input of finalMRule.input)
        {
            await this.buildFile(input);
        }

        // Build this file
        if (finalMRule.action)
        {
            this.currentRule = finalMRule;
            try
            {
                for (let action of finalMRule.action)
                {
                    if (typeof(action) === 'function')
                    {
                        await action.call(this, finalMRule);
                    }   
                    else
                    {
                        throw new Error("not implemented - execute string actions");
                    }
                }
            }
            finally
            {
                this.currentRule = null;
            }
        }
    }
}


