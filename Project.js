import { fileURLToPath, pathToFileURL } from 'node:url';
import { posix as path, default as ospath } from "node:path";
import { mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { globSync } from 'glob';
import { toPosix, UserError, run, fileTime, quotedJoin, escapeRegExp, flatArray, quotedSplit, isDirectory } from "./utils.js";

const __dirname = ospath.dirname(fileURLToPath(import.meta.url));

let lastProj;

export class Project extends EventEmitter
{
    constructor()
    {
        super();
        this.projectDir = path.resolve(".");
        this.projectName = path.basename(this.projectDir);
        this.useBaseDir = this.projectDir;
    }

    // Default mkopts
    mkopts = {
        dir: null,
        globals: {},
        set: {},
        rebuild: false,
        libPath: [],
        dryrun: false,
        verbosity: 1,
        vars: false,
    };

    // Helper to create and load a project
    static async load(mkfile, mkopts)
    {
        let proj = new Project();
        await proj.#load(mkfile, mkopts);
        return proj;
    }

    // Load this project
    async #load(mkfile, mkopts)
    {
        // Check not already loaded
        if (this.projectFile)
            throw new UserError("Project already loaded");

        // Merge options
        Object.assign(this.mkopts, mkopts);

        // Set globals and vars
        this.set(this.mkopts.globals);
        this.set(this.mkopts.set);

        // Resolve path to mk file
        let absmkfile = path.resolve(mkfile);
        if (isDirectory(absmkfile))
        {
            absmkfile = path.join(absmkfile, "mk.js");
        }

        // Setup project variables
        this.projectFile = absmkfile;
        this.projectDir = this.mkopts.dir ? path.resolve(this.mkopts.dir) : path.dirname(this.projectFile);
        this.projectName = path.basename(this.projectDir);
        this.useBaseDir = this.projectDir;

        if (this.mtime(this.projectFile)==0)
            throw new UserError(`Make script '${this.projectFile}' not found`);

        // Load and call module
        let module = await import(pathToFileURL(this.projectFile).href);
        await module.default.call(this);

        // Dump variables
        if (this.mkopts.vars)
            this.dumpVars();
    }

    subProjects = {};

    async loadSubProject(mkfile, mkopts)
    {
        // Resolve mkfile relative to this project
        mkfile = path.resolve(this.projectDir, mkfile);

        // Resolve options
        mkopts = Object.assign({}, this.mkopts, { dir: null, set: {} }, mkopts)
        let subProject = await Project.load(mkfile, mkopts);

        // Store and return
        this.subProjects[subProject.projectName] = subProject;
        return subProject;
    }

    // Rules for this project
    rules = [];

    // Create a property on 'object', named 'key' with
    // value 'val', where val can be a callback
    createProperty(object, key, val)
    {
        if (key in Object.getPrototypeOf(object))
            throw new UserError(`Can't override built-in property '${key}'`);

        // Callback
        if (typeof(val) === 'function')
        {
            let self = this;
            Object.defineProperty(object, key, {
                get: function() { return val.call(object, self) },
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

    vars = new Set();

    dumpVars()
    {
        process.stdout.write(`--- ${this.projectName} variables ---\n`);
        for (let key of this.vars)
        {   
            let val = this[key];
            if (val === undefined)
                continue;
            process.stdout.write(`${key}: ${JSON.stringify(this[key])}\n`);
        }
        process.stdout.write(`---\n`);
    }

    // Set properties on this project
    set(defs)
    {
        if (arguments.length == 2)
        {
            // set(key, val)
            let [key, val] = arguments;
            if (val === undefined)
                this.vars.delete(key);
            else
                this.vars.add(key);

            // Extension property?
            if (typeof(val) === 'function' && val.length > 0)
            {
                var prop = Object.getOwnPropertyDescriptor(this, key);
                if (prop.value)
                {
                    this.createProperty(this, key, () => val.call(this, prop.value));
                }
                else
                {
                    this.createProperty(this, key, () => val.call(this, prop.get.call(this)));
                }
            }
            else
            {
                this.createProperty(this, key, val);
            }
        }
        else
        {
            // set({key: val, ...})
            for (let [key, val] of Object.entries(defs))
            {
                this.set(key, val);
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
                this.set(key, val);
            return;
        }

        // default({key: val, ...})
        for (let [key, val] of Object.entries(defs))
        {
            if (this[key] === undefined)
                this.set(key, val);
        }
    }

    resolve(p)
    {
        return path.resolve(this.projectDir, p);
    }

    relative(p)
    {
        return path.relative(this.projectDir, p);
    }

    // Register a rule for this project
    rule(rule)
    {        
        // Convert callback properties to getters
        this.createProperty(rule, "name", rule.name);
        this.createProperty(rule, "output", rule.output);
        this.createProperty(rule, "deps", rule.deps);
        this.createProperty(rule, "condition", rule.condition);
        this.createProperty(rule, "mkdir", rule.mkdir);
        this.createProperty(rule, "subject", rule.subject);

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
            throw new UserError("use() requires a string or callback that resolves to a string");

        // Resolve .js file
        let jsFile;
        if (item.startsWith("."))
        {
            // Load relative to project
            jsFile = path.join(this.useBaseDir, item);

            // Check it exists
            if (this.mtime(jsFile) == 0)
                throw new UserError(`File '${jsFile}" not found`);
        }
        else
        {
            // Setup full search path
            let libPath = [
                ...this.mkopts.libPath,
                path.join(__dirname, "tools"),
                path.join(homedir(), ".mk.js"),
            ];

            // Check ends with ".js"
            let originalItem = item;
            if (!item.endsWith(".js"))
                item += ".js";

            // Search on lib path
            for (let libDir of libPath)
            {
                let p = path.join(libDir, item);
                if (fileTime(p) !== 0)
                {
                    jsFile = p;
                    break;
                }
            }

            if (!jsFile)
                throw new UserError(`Can't find library '${originalItem}"`);

        }

        // Load and call
        let saveUseBaseDir = this.useBaseDir;
        this.useBaseDir = path.dirname(jsFile);
        try
        {
            let module = await import(pathToFileURL(jsFile).href);
            await module.default.call(this);
        }
        finally
        {
            this.useBaseDir = saveUseBaseDir;
        }
    }

    // Perform a glob operation relative to the project home
    glob(pattern, options)
    {
        let opts = Object.assign({
            cwd: this.projectDir,
            posix: true,
        }, options);

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
    mtime(filename)
    {
        if (this.mkopts.dryrun)
        {
            let time = this.#dryRunMTimes.get(filename);
            if (time !== undefined)
                return time;
        }

        return fileTime(ospath.resolve(this.projectDir, filename));
    }

    // Can this project build a file?
    // Either has a rule, or the file exists
    canBuild(filename)
    {
        var rules = this.findRules(filename);
        if (rules.length > 0)
            return true;
        return this.mtime(filename) != 0;
    }

    // Find all rules for a target
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
                        deps: flatArray(rule.deps).map(x => x.replace(/\%/g, () => m[1])),
                    });

                    // Special case for the subject property to delay evaluation
                    // until rule executed.
                    this.createProperty(inferred, "subject", () => rule.subject);
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

    #builtTargets = new Map();

    // Make a single target
    async make(target)
    {
        if (Array.isArray(target))
        {
            // Build all targets
            for (let t of target)
            {
                await this.make(t);
            }
            return;
        }

        // If target  has already been built, then don't need to redo it return
        // the same result as last time
        let result = this.#builtTargets.get(target);
        if (result != undefined)
            return result;

        // Build it
        result = await this.#makeInternal(target);

        // Remember it
        this.#builtTargets.set(target, result);

        return result;
    }

    // Builds a file, returning 
    // - true if the file has rules
    // - false if the file has no rules but the file exists
    // If no rules, but file doesn't exist an exception is thrown
    async #makeInternal(target)
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
                throw new UserError(`Rule conflict: target '${target}' matches both named (non-file) and file rules`);

            // Only one rule can have an action
            if (rule.action)
            {
                if (mrule.primaryRule)
                    throw new UserError(`Multiple rules have actions for target '${target}'`);

                // Combine deps
                // Action rule inputs go at the start
                mrule.deps.unshift(...flatArray(rule.deps));

                // Store the primary fule
                mrule.primaryRule = rule;
            }
            else
            {
                // Combine deps
                // Non-action rule inputs go at the end
                mrule.deps.push(...flatArray(rule.deps));
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
                throw new UserError(`Multiple inferred rules match file '${target}'`);
            }
        }

        // No matching rules?
        if (finalMRule.rules.length == 0)
        {
            // Throw error unless this is a file target and it exists
            if (this.mtime(target) != 0)
                return false;

            throw new UserError(`No rule for target '${target}'`);
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
                let inputHasRules = await this.make(dep);

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
                await this.make(dep);
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
                    let actions = flatArray(finalMRule.primaryRule.action);
                    if (actions.length > 0)
                    {
                        // Log file build....
                        if (finalMRule.isFileTarget)
                        {
                            if (this != lastProj)
                            {
                                if (lastProj)
                                    this.log(1, ``);
                                lastProj = this;
                                //this.log(1, `${"project".padStart(10, ' ')}: ${this.projectName} (./${path.relative(toPosix(process.cwd()), lastProjDir)})`);
                                this.log(1, `----- ${this.projectName} (./${path.relative(toPosix(process.cwd()), this.projectDir)}) -----`);
                            }
                            this.log(1, `${(finalMRule.primaryRule.name ?? "creating").padStart(10, ' ')}: ${finalMRule.primaryRule.subject ?? target} `);
                        }
//                        else
//                            this.log(1, `${finalMRule.primaryRule.name}`);

                        // Make output directory?
                        if (finalMRule.isFileTarget && finalMRule.rules.some(x => x.mkdir) && !this.mkopts.dryrun)
                        {
                            mkdirSync(path.dirname(path.join(this.projectDir, target)), { recursive: true });
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
            cmd = await cmd.call(this, this.currentRule, opts);
            if (!cmd)
                return;
        }   

        // Handle different cmd types
        let cmdargs;
        if (typeof(cmd) === 'string')
        {
            // eg: "ls -al"
            cmdargs = quotedSplit(cmd);
        }
        else if (Array.isArray(cmd))
        {
            // eg: ["ls", "-al"]
            cmdargs = flatArray(cmd);
        }
        else if (cmd.cmdargs)
        {
            if (typeof(cmd.cmdargs) === 'string')
                // eg: { cmdargs: "ls -al", opts: { cwd: "/" } }
                cmdargs = quotedSplit(this.cmd.cmdargs);
            else    
                // eg: { cmdargs: [ "ls", "-al" ], opts: { cwd: "/" } ]
                cmdargs = flatArray(cmd.cmdargs);

            Object.assign(opts, cmd.opts);
        }
        else
        {
            throw new UserError(`Don't know how to exec '${cmd}'`)
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


