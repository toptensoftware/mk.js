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

    // Default make options
    mkopts = {
        mkfile: "./mk.js",
        dir: ".",
        globals: {},
        targets: [],
        rebuild: false,
        libPath: [],
        dryrun: false,
        verbosity: 1,
    }

    // Rules for this project
    rules = [];

    // Set to true if any actions invoked
    #actionsTaken = false;

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
        // Convert properties that need evaluation to accessor functions
        this.createProperty(rule, "name", rule.name);
        this.createProperty(rule, "output", rule.output);
        this.createProperty(rule, "deps", rule.deps);
        this.createProperty(rule, "condition", rule.condition);
        this.createProperty(rule, "mkdir", rule.mkdir);

        // Null out empty actions
        /*
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
        */

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
            loadPath = path.join(this.projDir, item);
        }
        else
        {
            // Search on lib path
            for (let libDir of this.mkopts.libPath)
            {
                let p = path.join(libDir, item + ".js");
                if (this.mtime(p) !== 0)
                {
                    loadPath = p;
                    break;
                }
            }
        }

        // Call it
        let module = await import(pathToFileURL(loadPath).href);
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

    #builtTargets = new Map();

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

    async buildTarget(target)
    {
        // Eval the filename
        target = this.eval(target);

        // If target  has already been built, then don't need to redo it return
        // the same result as last time
        let r = this.#builtTargets.get(target);
        if (r != undefined)
            return r;

        // Build it
        r = await this.buildTargetInternal(target);

        // Remember it
        this.#builtTargets.set(target, r);

        return r;
    }

    // Builds a file, returning 
    // - true if the file has rules
    // - false if the file has no rules but the file exists
    // If no rules, but file doesn't exist an exception is thrown
    async buildTargetInternal(target)
    {
        let self = this;

        // Find rules for this file
        let rules = this.findRules(target);

        // The final MRule ("merged rule")
        let finalMRule = {
            target: target,
            isFileTarget: undefined,
            action: null,
            deps: [],
            rules: [],
        };

        function copyMRule(mrule)
        {
            return {
                target: mrule.target,
                isFileTarget: mrule.isFIleTarget,
                action: mrule.action,
                deps: mrule.deps.slice(),
                rules: mrule.rules.slice(),
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
                if (mrule.action)
                    throw new Error(`Multiple rules have actions for target '${target}'`);
                mrule.action = ensureArray(rule.action);

                // Combine inputs
                // Action rule inputs go at the start
                mrule.deps.unshift(...ensureArray(rule.deps).flat(Infinity));

                // Name comes from this rule
                mrule.name = rule.name;
            }
            else
            {
                // Combine inputs
                // Non-action rule inputs go at the end
                mrule.deps.push(...ensureArray(rule.deps).flat(Infinity));
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

        // Build all inputs
        let needsBuild = false;
        if (finalMRule.isFileTarget)
        {
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
            // Non file targets, always built
            needsBuild = true;
            for (let dep of finalMRule.deps)
            {
                await this.buildTarget(dep);
            }
        }


        this.currentRule = finalMRule;
        try
        {
            if (!needsBuild)
            {
                // Check for other triggers
                for (let r of finalMRule.rules)
                {
                    for (let nb of ensureArray(r.needsBuild))
                    {
                        if (nb.call(r, this))
                        {
                            needsBuild = true;
                            break;
                        }
                    }
                    if (needsBuild)
                        break;
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

                // Display message
                if (finalMRule.action?.length ?? 0 > 0)
                {
                    if (finalMRule.isFileTarget)
                    {
                        // Log file build....
                        this.log(1, `${finalMRule.name ?? "running"}: ${target}`);

                        // Make output directory?
                        if (finalMRule.rules.some(x => x.mkdir))
                        {
                            if (!this.mkopts.dryrun)
                                mkdirSync(path.dirname(target), { recursive: true });
                            this.#actionsTaken = true;
                        }
                    }
                }

                // Build this file
                if (finalMRule.action)
                {
                    for (let action of finalMRule.action)
                    {
                        await this.exec(action);
                    }
                    this.#actionsTaken = true;
                }


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

    log(level, message)
    {
        if (level <= this.mkopts.verbosity)
        {
            process.stdout.write(message + "\n");
        }
    }

    async make()
    {
        // Check not already loaded
        if (this.projectFile)
            throw new Error("Project already loaded");

        // Resolve targets
        if (this.mkopts.targets.length == 0)
            this.mkopts.targets = [ "build" ]

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

        // Build all targets
        for (let t of this.mkopts.targets)
        {
            await this.buildTarget(this.eval(t));
        }

        if (!this.#actionsTaken)
        {
            this.log(1, "All targets up to date");
        }
        else if (this.mkopts.dryrun)
        {
            this.log(1, "## dry run, nothing updated");
        }
    }
}


