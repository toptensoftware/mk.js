import { fileURLToPath, pathToFileURL } from 'node:url';
import { posix as path, default as ospath } from "node:path";
import { mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { homedir } from 'node:os';
import { globSync } from 'glob';
import { toPosix, UserError, run, fileTime, quotedJoin, escapeRegExp, flatArray, quotedSplit, isDirectory, selectMkFileInDirectory, readSubDirectories } from "./utils.js";
import { spawnSync } from 'node:child_process';

// Register module loader hook for "mk"
register("./loaderHooks.js", import.meta.url);

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
        this.vars = new Set([ "projectDir", "projectName" ]);
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
            let resolved = selectMkFileInDirectory(absmkfile);
            if (!resolved)
            {
                throw new UserError(`No make script in directory '${absmkfile}'`);
            }
            absmkfile = resolved;
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
        if (this.mkopts.dumpvars)
            this.dumpVars();
    }

    subProjects = [];

    async loadAllSubProjects(dir)
    {
        if (!dir)
            dir = ".";

        let dirs = readSubDirectories(this.resolve(dir));

        for (let d of dirs)
        {
            if (selectMkFileInDirectory(path.join(dir, d)))
                await this.loadSubProject(d);
        }
    }

    async loadSubProject(mkfile, mkopts)
    {
        // Resolve mkfile relative to this project
        mkfile = path.resolve(this.projectDir, mkfile);

        // Resolve options
        mkopts = Object.assign({}, this.mkopts, { dir: null, set: {} }, mkopts)
        let subProject = await Project.load(mkfile, mkopts);

        // Store and return
        this.subProjects.push(subProject);
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
        // Setup a fake current rule while dumping vars in case any variables
        // reference current rule variables
        let oldcurrentTarget = this.currentTarget;
        if (!this.currentTarget)
        {
            this.currentTarget = {
                target: "target.file",
                deps: [ "depfile1.file", "depfile2.file" ],
            }
        }

        process.stdout.write(`--- ${this.projectName} variables ---\n`);
        for (let key of [...this.vars].sort())
        {   
            let val = this[key];
            if (val === undefined)
                continue;
            process.stdout.write(`${key}: ${JSON.stringify(this[key], null, 4)}\n`);
        }
        process.stdout.write('\n');

        this.currentTargets = oldcurrentTarget;
    }

    // Set properties on this project
    set(defs)
    {
        if (arguments.length == 2)
        {
            
            // set(key, val)
            let [key, val] = arguments;


            if (key == "gcc_link_defaults")
                debugger;

            if (val === undefined)
                this.vars.delete(key);
            else
                this.vars.add(key);

            // Extension property?
            if (typeof(val) === 'function' && val.length > 0)
            {
                var prop = Object.getOwnPropertyDescriptor(this, key);
                if (!prop)
                {
                    this.createProperty(this, key, () => val.call(this, undefined));
                }
                else if (prop.value)
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
                delete this[key];
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
        this.createProperty(rule, "enabled", rule.enabled);
        this.createProperty(rule, "mkdir", rule.mkdir);
        this.createProperty(rule, "subject", rule.subject);
        this.createProperty(rule, "order", rule.order ?? 0);
        this.createProperty(rule, "priority", rule.priority ?? 0);

        // Also store the load order
        rule.loadOrder = this.rules.length;

        // Capture location of rule definition
        rule.stack = (new Error()).stack;

        // Store rule
        this.rules.push(rule);

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

            // Check extension
            let originalItem = item;
            if (!item.match(/(\.js|\.mjs|\.cjs)$/))
                item += ".mjs";

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
            posix: true,
        }, options);

        opts.cwd = path.resolve(this.projectDir, options?.cwd ?? ".");

        let result = globSync(pattern, opts);
        return result;
    }

    // Current rule vars
    get ruleTarget() { return this.currentTarget?.target }
    get ruleCombinedDeps() { return this.currentTarget?.deps }
    get ruleFirstCombinedDep() { return this.currentTarget == null ? null : this.currentTarget.deps.length > 0 ? this.currentTarget.deps[0] : null }
    get ruleUniqueCombinedDeps() { return this.currentTarget == null ? null : [...new Set(this.currentTarget.deps)]}
    get ruleDeps() { return this.currentTarget?.deps }
    get ruleFirstDep() { return this.currentTarget?.rule == null ? null : this.currentTarget.rule.deps.length > 0 ? this.currentTarget.rule.deps[0] : null }
    get ruleUniqueDeps() { return this.currentTarget?.rule == null ? null : [...new Set(this.currentTarget.rule.deps)]}
    get ruleStem() { return this.currentTarget?.rule == null ? null : this.currentTarget.rules.stem }


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

    #doesRuleMatchTarget(rule, target)
    {
        // Ignore disabled rules
        if (!(rule.enabled ?? true))
            return false;

        // Named rule
        if (!rule.output)
        {
            // Match rule name
            return rule.name === target;
        }
        else
        {
            // Explicit output file?
            if (rule.output.indexOf("%") < 0)
                return rule.output === target;

            // Inferred rules?
            let regex = new RegExp("^" + escapeRegExp(rule.output).replace(/\%/g, "(.+)") + "$");
            return regex.exec(target);
        }
    }

    // Can this project build a target?
    // Either has a rule, or the file exists
    canBuild(target)
    {
        if (this.rules.some(x => this.#doesRuleMatchTarget(x, target)))
            return true;

        return this.mtime(target) != 0;
    }

    // Find all rules for a target
    findRules(target)
    {
        let ruleForOrder = {};

        // Look for explicit rules
        for (let rule of this.rules)
        {
            // Match it
            let m = this.#doesRuleMatchTarget(rule, target)
            if (!m)
                continue;

            let matchedRule;
            if (m === true)
            {
                // Explicit rule
                matchedRule = rule;
            }
            else
            {
                // Create inferred rule
                matchedRule = Object.assign({}, rule, {
                    output: target,
                    deps: flatArray(rule.deps).map(x => x.replace(/\%/g, () => m[1])),
                    stem: m[1],
                });

                // Check all input dependencies can be built
                if (!matchedRule.deps.every(x => this.canBuild(x)))
                    continue;

                // Special case for the subject property to delay evaluation
                // until rule executed.
                this.createProperty(matchedRule, "subject", () => rule.subject);

                matchedRule.inferredFrom = rule;
            }

            // Keep only the highest priority rule for this order
            let er = ruleForOrder[matchedRule.order];
            if (!er)
            {
                ruleForOrder[matchedRule.order] = matchedRule;
            }
            else
            {
                if (er.priority == matchedRule.priority)
                {
                    if (er.inferredFrom && !matchedRule.inferredFrom)
                    {
                        // matched rule is explicit, existing rule is inferred, replace
                        ruleForOrder[matchedRule.order]  = matchedRule;
                    }
                    else if (!er.inferredFrom && matchedRule.inferredFrom)
                    {
                        // matched rule is inferred, existing rule is explicit, ignore
                    }
                    else
                    {
                        throw new UserError(`Rule conflict: target '${target}' has multiple ${matchedRule.inferredFrom ? "inferred" : "explicit"} rules with order ${matchedRule.order} and priority ${matchedRule.priority}`);
                    }
                }
                else if (matchedRule.priority > er.priority)
                {
                    // matched rule has a higher priority, use it
                    ruleForOrder[matchedRule.order]  = matchedRule;
                }
            }
        }

        // Return sorted by order
        return Object.keys(ruleForOrder).toSorted((a,b) => a - b).map(x => ruleForOrder[x]);
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

    // Builds a target, returning true if a file target, or false if named target
    async #makeInternal(target)
    {
        let self = this;

        // Find rules for this file
        let rules = this.findRules(target);

        // Check all rules have unique order
        let deps = [];
        let isFileTarget = true;
        for (let i=0; i<rules.length; i++)
        {
            // Combine all deps
            deps.push(...flatArray(rules[i].deps))

            // Work out if it's a file or named target
            if (i == 0)
                isFileTarget = !!rules[i].output;
            else
                if (isFileTarget != !!rules[i].output)
                    throw new UserError(`Rule conflict: target '${target}' matches both file and named rules`);
        }

        // No matching rules?
        if (rules.length == 0)
        {
            // Throw error unless this is a file target and it exists
            if (isFileTarget && this.mtime(target) !== 0)
                return false;

            throw new UserError(`No rule for target '${target}'`);
        }

        // Build dependencies
        let needsBuild = false;
        if (isFileTarget)
        {
            // File targets
            let outputTime = this.mtime(target);
            needsBuild = this.mkopts.rebuild || outputTime === 0;
            for (let dep of deps)
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
            for (let dep of deps)
            {
                await this.make(dep);
            }
        }


        try
        {
            this.currentTarget = { 
                target: target, 
                rules: rules,
                deps: deps,
                rule: null,
            };

            // Check for other triggers
            if (!needsBuild)
            {
                for (let r of rules)
                {
                    this.currentTarget.rule = r;
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
                this.emit("skipTarget", this.currentTarget);
            }
            else
            {
                this.emit("willMakeTarget", this.currentTarget)

                // Make output directory?
                if (isFileTarget && rules.some(x => x.mkdir) && !this.mkopts.dryrun)
                {
                    mkdirSync(path.dirname(path.join(this.projectDir, target)), { recursive: true });
                }

                // Execute all rules
                for (let r of rules)
                {
                    this.currentTarget.rule = r;
                    this.emit("willInvokeRule", this.currentTarget)


                    let actions = flatArray(r.action);
                    if (actions.length > 0)
                    {
                        // Log file build....
                        if (isFileTarget)
                        {
                            // Log different project
                            if (this != lastProj)
                            {
                                if (lastProj)
                                    this.log(1, ``);
                                lastProj = this;
                                this.log(1, `----- ${this.projectName} (./${path.relative(toPosix(process.cwd()), this.projectDir)}) -----`);
                            }

                            // Log action
                            this.log(1, `${(r.name ?? "creating").padStart(10, ' ')}: ${r.subject ?? target} `);
                        }

                        // Run actions
                        for (let action of actions)
                        {
                            await this.exec(action);
                        }
                    }

                    this.emit("didInvokeRule", this.currentTarget)
                    this.currentTarget.rule = r;
                }

                // If dry run, store current time as the mtime for file targets
                if (this.mkopts.dryrun && isFileTarget)
                    this.#dryRunMTimes.set(target, Date.now());

                this.emit("didMakeTarget", this.currentTarget);
            }
        }
        finally
        {
            this.currentTarget = null;
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
            cmd = await cmd.call(this, this.currentTarget, opts);
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

    // Execute a command synchronously and return stdout
    shell(cmd, opts)
    {
        // Resolve opts
        opts = Object.assign({
            cwd: this.projectDir,
            shell: true,
            encoding: "utf-8",
        }, opts);

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
            return "";

        this.log(2, `${opts.cwd}$ ${quotedJoin(cmdargs)}`);

        // Run it
        let r = spawnSync(cmdargs[0], cmdargs.splice(1), opts);
        return r.stdout.trimEnd();
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


