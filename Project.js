import { fileURLToPath, pathToFileURL } from 'node:url';
import { posix as path, default as ospath } from "node:path";
import { mkdirSync } from 'node:fs';

import { run, fileTime, resolve, quotedJoin, escapeRegExp, toArray, toBool, toString, quotedSplit } from "./utils.js";
import { EventEmitter } from 'node:events';

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

export class Project extends EventEmitter
{
    constructor()
    {
        super();
    }

    // Global variables used by this project and sub-projects
    globals = {};

    // Local variables only used by this project
    vars =  {}

    // Rules for this project
    rules = [];

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
        this.vars.home = path.dirname(absmkfile);
        this.vars.name = path.basename(this.vars.home);

        // Load and call module
        let module = await import(pathToFileURL(absmkfile).href);
        await module.default.call(this);
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
        if (!rule.output)
            throw new Error("Rule must have output target name");

        // Add to list
        this.rules.push(rule);

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
        let module = await import(pathToFileURL(loadPath).href);
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
                    case "ruleOutput":
                        return this.currentRule.output;
                    case "ruleInput":
                        return this.currentRule.input;
                    case "ruleFirstInput":
                        return this.currentRule.input.length > 0 ? this.currentRule.input[0] : null;
                    case "ruleUniqueInput":
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
    findrules(filename)
    {
        let rules = [];

        // Look for explicit ruls
        let haveAction = false;
        let haveInferredRules = false;
        for (let rule of this.rules)
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
        for (let rule of this.rules)
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
                        mkdir: rule.mkdir,
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
        var rules = this.findrules(filename);
        if (rules.length > 0)
            return true;
        return this.mtime(filename) != 0;
    }

    builtFiles = new Map();

    // Builds a file, returning 
    // - true if the file has rules
    // - false if the file has no rules but the file exists
    // If no rules, but file doesn't exist an exception is thrown
    async buildTarget(target)
    {
        let self = this;

        // Eval the filename
        target = this.evalString(target);

        // If file has already been build, then don't need to redo it return
        // the same result as last time
        let r = this.builtFiles.get(target);
        if (r != undefined)
            return r;

        console.log(`Building ${target}`);

        // Find rules for this file
        let rules = this.findrules(target);

        // The final MRule ("merged rule")
        let finalMRule = {
            output: target,
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
                    throw new Error(`Multiple rules define build actions for file '${target}'`);
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
                throw new Error(`Multiple inferred rules match file '${target}'`);
            }
        }

        // If there are no rules for this file, then check it exists
        if (finalMRule.rules.length == 0)
        {
            if (this.mtime(target) == 0)
            {
                throw new Error(`No rule for target '${target}'`);
            }
            this.builtFiles.set(target, false);
            return false;
        }

        // Build all inputs
        let outputTime = this.mtime(target);
        let needsBuild = outputTime === 0;
        for (let input of finalMRule.input)
        {
            let inputHasRules = await this.buildTarget(input);

            // Check input dependencies
            if (!needsBuild)
            {
                let inputTime = this.mtime(input);
                if ((inputTime === 0 && inputHasRules) || (inputTime > outputTime))
                    needsBuild = true;
            }
        }

        this.currentRule = finalMRule;
        try
        {
            if (!needsBuild)
            {
                this.emit("skipFile", target, finalMRule);
            }
            else
            {
                this.emit("willbuildTarget", target, finalMRule)

                // Make output directory?
                if (finalMRule.rules.some(x => this.evalBool(x.mkdir)))
                {
                    mkdirSync(path.dirname(target), { recursive: true });
                }

                // Build this file
                if (finalMRule.action)
                {
                    for (let action of finalMRule.action)
                    {
                        await this.exec(action);
                    }
                }

                this.emit("didbuildTarget", target, finalMRule);
            }
        }
        finally
        {
            this.currentRule = null;
        }

        this.builtFiles.set(target, true);
        return true;
    }

    async exec(action, opts)
    {
        // default opts
        opts = Object.assign({
            cwd: this.resolveString("home"),
            stdio: "inherit",
            shell: true,
        }, opts);

        // Callback function?
        if (typeof(action) === 'function')
        {
            action = await action.call(this, this.currentRule, opts);
            if (action === undefined)
                return;
        }   

        // String?
        if (typeof(action) === 'string')
        {
            action = quotedSplit(this.evalString(action));
        }

        if (Array.isArray(action))
        {
            action = { cmdargs: action }
        }

        if (action.cmdargs)
        {
            // Resolve cmd args
            let cmdargs = this.evalArray(action.cmdargs);
            while (true)
            {
                if (cmdargs[0].startsWith('-'))
                {
                    cmdargs[0] = cmdargs[0].substring(1);
                    opts.ignoreExitCode = true;
                }
                else if (cmdargs[0].startsWith('@'))
                {
                    cmdargs[0] = cmdargs[0].substring(1);
                    opts.stdio = [ "ignore", "inherit", "inherit" ];
                }
                else
                    break;
            }

            Object.assign(opts, action.opts);

            return await run(cmdargs, opts);
        }

        throw new Error(`Don't know how to exec '${action}'`)
    }
}


