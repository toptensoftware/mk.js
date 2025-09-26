import { fileURLToPath, pathToFileURL } from 'node:url';
import { posix as path, default as ospath } from "node:path";
import { mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { globSync } from 'glob';
import { run, fileTime, quotedJoin, escapeRegExp, ensureArray, quotedSplit } from "./utils.js";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

export class Project extends EventEmitter
{
    constructor()
    {
        super();
    }

    // Default mkopts
    mkopts = {
        mkfile: "./mk.js",
        dir: ".",
        globals: {},
        rebuild: false,
        libPath: [],
        dryrun: false,
        verbosity: 1,
    };

    // Load a project
    async load(mkopts)
    {
        // Check not already loaded
        if (this.projectFile)
            throw new Error("Project already loaded");

        // Merge options
        Object.assign(this.mkopts, mkopts);

        // Add the standard tools path
        this.mkopts.libPath.push(path.join(__dirname, "tools"));
        
        // Set globals
        this.set(this.mkopts.globals);

        // Resolve path to mk file
        let absmkfile = path.resolve(this.mkopts.mkfile);

        // Setup project variables
        this.projectFile = absmkfile;
        this.projectDir = path.resolve(this.mkopts.dir) ?? path.dirname(this.projectFile);
        this.projectName = path.basename(this.projectDir);

        // Load and call module
        let module = await import(pathToFileURL(this.projectFile).href);
        await module.default.call(this);
    }

    // Rules for this project
    rules = [];

    // Evaluate a value by invoking callbacks, and expanding strings
    // val - the value to evaluate
    // [callbackThis] - the value of "this" for callbacks (this if unspecified)
    eval(val, callbackThis)
    {
        // Recursively evaluate arrays
        if (Array.isArray(val))
            return val.map(x => this.eval(x, callbackThis));

        switch (typeof(val))
        {
            case "function":
                if (callbackThis === undefined)
                    return this.eval(val.call(this));
                else
                    return this.eval(val.call(callbackThis, this), callbackThis);

            case "string":
                return val.replace(/\$\(([^)]+)\)/g, (m, varname) => {
                    let v = this[varname];
                    if (v === undefined || v === null)
                        return "";
                    if (Array.isArray(v))
                        return quotedJoin(v);
                    else
                        return v;
                });
        }

        return val;
    }

    // Create a property on 'object', named 'key' with
    // value 'val' that will be this.eval'd each acces
    createProperty(object, key, val)
    {

        if (key in Object.getPrototypeOf(object))
            throw new Error(`Can't override built-in property '${key}'`);


        let self = this;

        // Is it a type that needs evaluating?
        if (Array.isArray(val) || 
            (typeof(val) === 'string' && val.indexOf("$(") >= 0)  ||
            typeof(val) === 'function' ||
            typeof(val) === 'object')
        {
            Object.defineProperty(object, key, {
                get: function() { return self.eval(val, object) },
                enumerable: true,
                configurable: true
            });
        }
        else if (val === undefined)
        {
            // Delete key?
            delete object[key];
        }
        else
        {
            // Set simpel value
            object[key] = val;
        }
    }

    // Set properties on this project
    set(defs)
    {
        if (arguments.length == 2)
        {
            // set(key, val)
            let [key, val] = arguments;
            this.createProperty(this, key, val);
        }
        else
        {
            // set({key: val, ...})
            for (let [key, val] of Object.entries(defs))
            {
                this.createProperty(this, key, val);
            }
        }
    }   

    // Set properties on this project, but only if
    // not already defined.
    default(defs)
    {
        if (arguments.length == 2)
        {
            // default(key, val)
            let [key, val] = arguments;
            if (this[key] === undefined)
                this.createProperty(this, key, val);
            return;
        }

        // default({key: val, ...})
        for (let [key, val] of Object.entries(defs))
        {
            if (this[key] === undefined)
                this.createProperty(this, key, val);
        }
    }

    // Register a rule for this project
    rule(rule)
    {        
        // Convert properties that need evaluation accessor functions
        this.createProperty(rule, "name", rule.name);
        this.createProperty(rule, "output", rule.output);
        this.createProperty(rule, "deps", rule.deps);
        this.createProperty(rule, "condition", rule.condition);
        this.createProperty(rule, "mkdir", rule.mkdir);

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
        this.rules.push(rule);
    }

    // use(jsfile)
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

        // Resolve .js file
        let jsFile;
        if (item.startsWith("."))
        {
            // Load relative to project
            jsFile = path.join(this.projDir, item);
        }
        else
        {
            // Search on lib path
            for (let libDir of this.mkopts.libPath)
            {
                let p = path.join(libDir, item + ".js");
                if (this.mtime(p) !== 0)
                {
                    jsFile = p;
                    break;
                }
            }
        }

        // Load and call
        let module = await import(pathToFileURL(jsFile).href);
        module.default.call(this);
    }

    // Perform a glob operation relative to the project home
    glob(pattern, options)
    {
        let opts = Object.assign({
            cwd: this.projectDir,
            posix: true,
        }, options);

        pattern = this.eval(pattern);
        return globSync(pattern, opts);
    }

    // Current rule vars
    get ruleTarget() { return this.currentRule?.target }
    get ruleDeps() { return this.currentRule?.deps }
    get ruleFirstDep() { return this.currentRule == null ? null : this.currentRule.deps.length > 0 ? this.currentRule.deps[0] : null }
    get ruleUniqueDeps() { return this.currentRule == null ? null : [...new Set(this.currentRule.deps)]}
    get ruleStem() { return this.currentRule == null ? null : this.currentRule.rules[0].stem }


    #dryRunMTimes  = new Map();

    // Get the modification time of a file, or 0 if it doesn't exist
    // Override for mock file testing
    // filename should be expanded
    mtime(filename)
    {
        if (this.mkopts.dryrun)
        {
            let time = this.#dryRunMTimes.get(filename);
            if (time !== undefined)
                return time;
        }

        return fileTime(filename);
    }

    // Can this project build a file?
    // Either has a rule, or the file exists
    // filename should be expanded
    canBuild(filename)
    {
        var rules = this.findRules(filename);
        if (rules.length > 0)
            return true;
        return this.mtime(filename) != 0;
    }

    // Find all rules for a target
    // filename should be fully expanded
    findRules(target)
    {
        let rules = [];

        // Look for explicit rules
        let inferenceRules = [];
        for (let rule of this.rules)
        {
            // Named rule
            if (!rule.output)
            {
                // Match rule name
                if (rule.name === target)
                {
                    rules.push(rule);
                }
            }
            else
            {
                // Explicit output file?
                if (rule.output.indexOf("%") < 0)
                {
                    if (rule.output === target)
                        rules.push(rule);
                }
                else
                {
                    // Remember inferred rules for later
                    inferenceRules.push(rule);
                }
            }
        }

        // If have an action, don't use inferred rules
        if (!rules.some(x => x.action))
        {
            // Create inferred rules
            for (let rule of inferenceRules)
            {
                // Match input pattern
                let pattern = rule.output;

                // Inferred rules?
                let regex = new RegExp("^" + escapeRegExp(pattern).replace(/\%/g, "(.+)") + "$");
                let m = regex.exec(target);
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
                    inferred = Object.assign({}, rule, {
                        output: target,
                        deps: ensureArray(rule.deps).map(x => x.replace(/\%/g, () => m[1])),
                    });
                }

                // Add to list
                if (inferred)
                {
                    inferred.inferredFrom = rule;
                    inferred.stem = m[1];
                    rules.push(inferred);
                }
            }
        }

        rules = rules.filter(x => x.condition ?? true);

        return rules;
    }

    // Build a list of targets
    async buildTargets(targets)
    {
        // Build all targets
        for (let t of targets)
        {
            await this.buildTarget(this.eval(t));
        }

        if (this.mkopts.dryrun)
        {
            this.log(1, "## dry run, nothing updated");
        }
    }


    #builtTargets = new Map();

    // Build a single target
    async buildTarget(target)
    {
        // Eval the filename
        target = this.eval(target);

        // If target  has already been built, then don't need to redo it return
        // the same result as last time
        let result = this.#builtTargets.get(target);
        if (result != undefined)
            return result;

        // Build it
        result = await this.#buildTargetInternal(target);

        // Remember it
        this.#builtTargets.set(target, result);

        return result;
    }

    // Builds a file, returning 
    // - true if the file has rules
    // - false if the file has no rules but the file exists
    // If no rules, but file doesn't exist an exception is thrown
    async #buildTargetInternal(target)
    {
        let self = this;

        // Find rules for this file
        let rules = this.findRules(target);

        // The final MRule ("merged rule")
        let finalMRule = {
            target: target,
            isFileTarget: undefined,
            deps: [],
            rules: [],
            primaryRule: null,
        };

        function copyMRule(mrule)
        {
            return {
                target: mrule.target,
                isFileTarget: mrule.isFIleTarget,
                deps: mrule.deps.slice(),
                rules: mrule.rules.slice(),
                primaryRule: mrule.primaryRule,
            };
        }

        function addRule(mrule, rule)
        {
            // Merge file target
            let isFileTarget = !!rule.output;
            if (mrule.isFileTarget === undefined)
                mrule.isFileTarget = isFileTarget;
            else if (mrule.isFileTarget !== isFileTarget)
                throw new Error(`Rule conflict: target '${target}' matches both named (non-file) and file rules`);

            // Only one rule can have an action
            if (rule.action)
            {
                if (mrule.primaryRule)
                    throw new Error(`Multiple rules have actions for target '${target}'`);

                // Combine deps
                // Action rule inputs go at the start
                mrule.deps.unshift(...ensureArray(rule.deps).flat(Infinity));

                // Store the primary fule
                mrule.primaryRule = rule;
            }
            else
            {
                // Combine deps
                // Non-action rule inputs go at the end
                mrule.deps.push(...ensureArray(rule.deps).flat(Infinity));
            }

            // Add to list of rules
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

                    if (inferredMRule.deps.every(x => self.canBuild(x)))
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

        // No matching rules?
        if (finalMRule.rules.length == 0)
        {
            // Throw error unless this is a file target and it exists
            if (this.mtime(target) != 0)
                return false;

            throw new Error(`No rule for target '${target}'`);
        }

        // Build dependencies
        let needsBuild = false;
        if (finalMRule.isFileTarget)
        {
            // File targets
            let outputTime = this.mtime(target);
            needsBuild = this.mkopts.rebuild || outputTime === 0;
            for (let dep of finalMRule.deps)
            {
                let inputHasRules = await this.buildTarget(dep);

                // Check input dependencies
                if (!needsBuild)
                {
                    let inputTime = this.mtime(dep);
                    if ((inputTime === 0 && inputHasRules) || (inputTime > outputTime))
                        needsBuild = true;
                }
            }
        }
        else
        {
            // Non file targets (always built)
            needsBuild = true;
            for (let dep of finalMRule.deps)
            {
                await this.buildTarget(dep);
            }
        }


        try
        {
            // Set the current rule
            this.currentRule = finalMRule;

            // Check for other triggers
            if (!needsBuild)
            {
                for (let r of finalMRule.rules)
                {
                    if (r.needsBuild && r.needsBuild.call(r, this))
                    {
                        needsBuild = true;
                        break;
                    }
                }
            }

            if (!needsBuild)
            {
                this.log(2, `Skipping ${target}`);
                this.emit("skipFile", target, finalMRule);
            }
            else
            {
                this.emit("willbuildTarget", target, finalMRule)

                // Have actions?
                if (finalMRule.primaryRule)
                {
                    let actions = ensureArray(finalMRule.primaryRule.action);
                    if (actions.length > 0)
                    {
                        // Log file build....
                        if (finalMRule.isFileTarget)
                            this.log(1, `${finalMRule.primaryRule.name ?? "running"}: ${this.eval(finalMRule.primaryRule.subject) ?? target} `);
//                        else
//                            this.log(1, `${finalMRule.primaryRule.name}`);

                        // Make output directory?
                        if (finalMRule.isFileTarget && finalMRule.rules.some(x => x.mkdir) && !this.mkopts.dryrun)
                        {
                            mkdirSync(path.dirname(target), { recursive: true });
                        }

                        // Run actions
                        for (let action of actions)
                        {
                            await this.exec(action);
                        }
                    }
                }


                // If dry run, store current time as the mtime for file targets
                if (this.mkopts.dryrun && finalMRule.isFileTarget)
                    this.#dryRunMTimes.set(target, Date.now());

                this.emit("didbuildTarget", target, finalMRule);
            }
        }
        finally
        {
            this.currentRule = null;
        }

        return true;
    }

    // Execute a command
    async exec(cmd, opts)
    {
        // Resolve opts
        opts = Object.assign({
            cwd: this.projectDir,
            stdio: "inherit",
            shell: true,
        }, opts);

        // Callback function?
        if (typeof(cmd) === 'function')
        {
            return await cmd.call(this, this.currentRule, opts);
        }   

        // Handle different cmd types
        let cmdargs;
        if (typeof(cmd) === 'string')
        {
            // eg: "ls -al"
            cmdargs = quotedSplit(this.eval(cmd));
        }
        else if (Array.isArray(cmd))
        {
            // eg: ["ls", "-al"]
            cmdargs = this.eval(cmd);
        }
        else if (cmd.cmdargs)
        {
            if (typeof(cmd.cmdargs) === 'string')
                // eg: { cmdargs: "ls -al", opts: { cwd: "/" } }
                cmdargs = quotedSplit(this.eval(cmd.cmdargs));
            else    
                // eg: { cmdargs: [ "ls", "-al" ], opts: { cwd: "/" } ]
                cmdargs = ensureArray(this.eval(cmd.cmdargs));

            Object.assign(opts, cmd.opts);
        }
        else
        {
            throw new Error(`Don't know how to exec '${cmd}'`)
        }

        // Object with cmdargs
        if (cmdargs.length < 0)
            return;

        // Special prefix characters
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
                if (!this.mkopts.verbose)
                {
                    opts.stdio = [ "ignore", "ignore", "inherit" ];
                }
            }
            else
                break;
        }

        this.log(2, `${opts.cwd}$ ${quotedJoin(cmdargs)}`);

        // Don't actually run it
        if (this.mkopts.dryrun)
            return 0;

        // Run command
        return await run(cmdargs, opts);
    }

    // Log a message
    log(level, message)
    {
        if (level <= this.mkopts.verbosity)
        {
            process.stdout.write(message + "\n");
        }
    }

}


