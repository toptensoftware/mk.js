# mk.js - Javascript Based Build System

## Introduction

mk.js is a build system similar to `make` but with the power of JavaScript.

## Features

* Powerful variable system for flexible scripts
* Explicit and inferred rules
* File target and named target rules (aka .PHONY targets)
* Built-in support for sub-projects
* Built-in tool chains for `msvc` and `gcc` for C, C++ and assembly language builds
* Cross platform

## Installation

Assuming a recent version of NodeJS and NPM is installed:

```
npm install -g toptensoftware/mk.js
```

## Quick Guide

In a project directory, create a file `mk.js`.  This file declares
your make file variables, rules and other script.

```js
// Project entry point
export default async function()
{
    // Define some variables
    this.set({
        outputFile: "test.txt",
        greeting: "Hello",
        subject: "World",
        message: () => `${this.greeting} ${this.subject}`,
    });

    // File rule creates a file if it doesn't exist
    this.rule({
        output: () => this.outputFile,
        action: () => `echo ${this.message} > ${this.outputFile}`,
    });

    // Named rule "build"
    this.rule({
        name: "build",
        deps: () => this.outputFile,
    });

    // Named rule "clean"
    this.rule({
        name: "clean",
        action: () => `rm -f ${this.outputFile}`,
    });
}
```

Some notes about the above:

* Variables are declared using the `set()` function.
* File rules have an `output` property and optionally a `name`
* Named rules have a `name` property and no `output` property
* Rules can have file and named rule dependencies (aka prerequisites) 
  that are specified by the `deps` property.
* Rules have an optional `action` property that specifies what to do
  when the rule is invoked (typically invoking external commands)

To run the script, from the command line run `mk` with
no arguments - mk.js will look for a rule named "build" and run it:

```
~/Projects/mk.js/sample (main)$ mk
----- sample (./) -----
  creating: test.txt

~/Projects/mk.js/sample (main)$ cat test.txt
Hello World
```

To run a different rule, pass it as an argument.  

(Note the clean rule doesn't produce any output, because by default
only file rules produce output).

```
~/Projects/mk.js/sample (main)$ mk clean

~/Projects/mk.js/sample (main)$
```

To run the "clean" followed by the "build" rule:

```
~/Projects/mk.js/sample (main)$ mk clean build
----- sample (./) -----
  creating: test.txt

~/Projects/mk.js/sample (main)$
```

## Concepts

To make the most of mk.js there are a few key concepts to learn:

* Projects - a set of variables, rules and sub-projects
* Variables - settings that customize the build process
* Rules - describe how to build files and perform actions
* Libraries - re-usable variables and rules
* SubProjects - composing large projects from smaller ones


## Projects

The mk.js `Project` class declares a set of variables, rules and
sub-projects that comprise a build system.

When the root `mk.js` project script is loaded, its default exported
function is called and passed a `Project` instance as `this`.

```js
export default async function()
{
    // `this` is a reference to the `Project` instance
}
```

You can also programmatically load a project:

```js
import { Project } from "mk.js";

let project = await Project.load("mk.js", { /* mkopts, see below */ })
```

Or, manually create one:

```js
import { Project } from "mk.js";

let project = new Project();
```

### mkopts

A project has a set of options (referred to as `mkopts`) that
roughly map to command line arguments.  These can be passed to
`Project.load()` and are accessable via the project's `mkopts` property

```js
mkopts = {
    dir: null,      // project directory (defaults to mk.js directory)
    set: {},        // a set of variables for this project
    globals: {},    // a set of variables for this project and its sub-projects
    rebuild: false, // forces targets to build regardless of timestamps
    libPath: [],    // path to search for libraries
    dryrun: false,  // don't actually run executable tasks
    verbosity: 1,   // output verbosity
    vars: false,    // dump variables once project has been loaded
}
```

### A Note about the Current Directory

`mk.js` never changes its own process' current working directory.  

Rather:

* all file operations are resolved against the project's `projectDir` variable.
* when executing external commands, the cwd of that process is set to `projectDir`.

Care should be taken whenever a file path is used to actually access the file system
to first resolve it against the project's directory. 

To facilitate this, the project has a `resolve()` method to produce a full path from a 
relative path, and a `relative()` method to produce a relative path (to the project) from 
a full path. 

These methods should also be used when passing paths between projects and 
sub-projects by first calling `resolve()` on the source project and then `relative()` on 
the target project.

By not manipulating the `mk.js` process current working directory, multiple projects
can all be loaded and processed within the one NodeJS process making it easy to 
pass variables and settings between a project and its sub-projects.

## Variables

### Basics

Variables declare settings to customize and configure a build.

In the following examples you might be wondering why variables are declared the
way they are instead of just using local JavaScript variables?

The idea here is to use a more declarative, less procedural approach to describing 
a build - similar to how standard makefiles work.  For simple builds the difference 
is negligible but for more complex builds, and especially for builds that use 
toolchain libraries the described approach provides a lot more flexibility.

In general, variables are intended to be setup as the project is loaded and then
left as they are once the rules of the project start being processed.  Again, the 
idea is to declare a set of rules and variables and then let mk.js determine what
needs to be done based on those declarations.

Variables are set using the `set()` method and read as properties of the Project 
object:

```js
// Set a single property
this.set("apples", "red");
assert.equal(this.apples, "red")

// Set multiple properties by passing an object
this.set({
  pears: "green",
  bananas: "yellow",
});
assert.equal(this.pears, "green")
assert.equal(this.bananas, "yellow")
```

Variables can also be set using the `default()` method which works
the same as `set()`, except if a variable is already defined then it's left as is.

```js
// Set a single property
this.default({
  apples: "red"
});
this.default({
  apples: "green"   // no-op, since `apples` already defined.
});
assert.equal(this.apples, "red")
```

Variables can be any JavaScript type. 

### Dynamic Variables

Dynamic variables can be declared with a lambda function:

```js
// Dynamic property using a lambda
this.set({
  apples: "red",
  message: () => `apples are ${this.apples}`
});
assert.equal(this.message, "apples are red")

// Dynamic properties are re-evaluated each time they're called
this.set({ apples: "green" })
assert.equal(this.message, "apples are green")
```


Note that callback lambdas in arrays and objects are not recursively called, so 
to dynamically generate the content of the array do this:

```js
// You probably do want this :)
this.set({
  apples: "red",
  colors: () => [ "yellow", this.apples ],
});

assert.deepEqual(this.colors, [ "yellow", "red" ])
```

not this:

```js
// You probably don't want this :(
this.set({
  apples: "red",
  colors: [ "yellow", () => this.apples ],
});

// This will fail
assert.deepEqual(this.colors, [ "yellow", "red" ])
```

nor this:

```js
// You probably don't want this :(
this.set({
  apples: "red",
  colors: [ "yellow", this.apples ],
});

// This will pass
assert.deepEqual(this.colors, [ "yellow", "red" ])

// But this will fail if "apples" is changed
this.set({ apples: "greed" });
assert.deepEqual(this.colors, [ "yellow", "green" ])

```

### Derived Variables

Sometimes you might want to declaratively modify the value of
an existing variable.  This can be done by using a lambda with
an argument - the argument will be the previous value of the variable.

eg: suppose you want to add a value to an array

```js
// Declare an array
this.set({
  fruits: [ "apples", "pears" ]
});

// Add to existing array
this.set({
  fruits: (prev) => [...prev, "bananas"]
});

assert.deepEqual(this.fruits, [ "apples", "pears", "bananas" ]);
```

A similar approach using array `.filter()` can be used to remove values.


### Local vs Global Variables

mk.js supports two types of variables:

* Local variable apply just to the current project.
* Global variables apply to the current project and are automatically
  passed through to any sub-projects that the project loads.

Variables defined by the `set()` method inside a project are local 
variables.

Global variables are normally set using the command line.  eg: this
command sets the `config` and `platform` global variables for the
project being loaded and for any sub-project this project loads.

```
~/myproject/$ mk config=release platform=x64
```

To specify a local variable from the command line, prefix it with a period.

eg: this will set the variable `localvar` for the top-level project, but 
not the sub-projects.

```
~/myproject/$ mk .localvar=somevalue
```

When loading a sub-project (see the section on Sub Projects below) you
can modify the global variables that are passed by setting using the 
`globals` variable of the `mkopts` passed to the `loadProject` method

eg:

```js
await this.loadSubProject("sub-project", {
  globals: { 
    // Additional variables to be passed to the sub-project 
    // and any of its sub-project.  These will be merged with
    // the current mkopts.globals of this project.
    config: "release",
    platform: "x64",
  },
  set: {
    // Other variables for just the immediate sub-project.
  }
});
```




## Rules

mk.js supports two kinds types of rules:

* Named rules - describe actions to be invoked
* File rules - declare how a file is built

Rules are declared using the Project's `rule()` method.

### Named Rules

Named rules have a `name` but no `output` property.

Named rules don't perform time stamp checks on dependencies but do make
dependencies (which can be file or named rules) and the rule's own actions.

Named rules are similar to `.PHONY` targets in standard makefiles.


```js
this.rule({

  // the name of the rule
  name: "clean",

  // Other rules to invoke before this one
  deps: [ "clean-sub-projects" ]

  // The action to invoke
  action: () => `rm -rf ${this.buildDir}`,

});
```


### File Rules

File rules describe how to produce a file and are only invoked if the 
target file doesn't exist or is older than any of its dependencies.

File rules have an `output` property that identifies the file the
rule produces: 

```js
this.rule({

  // the file this rule produces
  output: "file.txt",

  // dependencies that if newer than the output will trigger the action
  deps: [ "other.txt" ],

  // The action to invoke
  // ie: cp other.txt file.txt
  action: () => `cp ${this.ruleDeps} ${ruleTarget}`,

});
```

Note that file rules can have a `name` property but it's for informational
purposes only and not used when matching targets to rules.

### Inferred File Rules

File rules can be inferred based on a pattern, using the `%` character
to represent any sequence of characters:

```js
this.rule({
  output: `%.obj`,
  deps: `%.c`,
  action: () => `gcc -o ${this.ruleOutput} -c ${this.ruleFirstDep}`,
});
```

When trying to produce a file `test.obj` the following rule would be inferred from the
above:

```js
{
  output: `test.obj`,
  deps: `test.c`,
  action: () => `gcc -o ${this.ruleOutput} -c ${this.ruleFirstDep}`,
}
```

Inferred rules are only used if a non-inferred rule with an action
can't be found.  If multiple inferred rules match a file they are merged 
(see Rule Merging below).


### Conditional Rules

A rule can be conditionally included by specifying a `condition` property.

This example picks one rule depending on the output file type

```js

// Produce an executable
this.rule({
  name: "link",
  output: () => this.outputFile,
  condition: () => !this.outputFile.endsWith(".lib"),
  action: () => { /* commands to link executable */ },
})

// Produce a library
this.rule({
  name: "lib",
  output: () => this.outputFile,
  condition: () => this.outputFile.endsWith(".lib"),
  action: () => { /* command to produce library */ },
})

```

### Automatically Creating Output Directories

A file rule can request the file's output directory to be automatically created by setting 
it's `mkdir` property to `true`.

```js
this.rule({
  name: "link",
  output: () => this.outputFile,
  mkdir: true,    // Create the outputFile directory before invoking action
  action: () => { /* produce file */ }
})
```

### Subject Files

When a file rule is invoked, a message is output to the console describing the rule's name
and the "subject" file.

This is an informational message to describe the file the action is working on. If the subject 
property is not set, the rule's output is used.

The primary reason for this property is to provide a nicer output message for compilation steps.  

For example, without the subject property, the message for a compile step might show
the object file name:

```txt
    compile: ./build/obj/main.obj
```

By setting a subject property:

```js
this.rule({
  name: "compile",
  output: () => this.ruleTarget,
  subject: () => this.ruleFirstDep,
  action: () => { /* etc... */ }
})
```

the output will show the source file name instead:

```txt
    compile: ./main.c
```

### Additional Build Checks

A rule can define an optional property `needsBuild` that can perform a final check
for additional triggers to cause a rule to be invoked.

If mk.js thinks a file is up to date, before skipping it, it will call the `needsBuild`
function to allow the rule one last chance to trigger the action.

The main purpose for this is for C/C++ header file change detection checks.  Rather than
generating rules for all the dependent `.h` files for a `.c` or `.cpp` file, this callback
can be used to load a `.d` dependencies file from a previous compilation and manually check
for additional change triggers.

```js
this.rule({
  name: "compile",

  // read .d file and check if any headers newer than this.ruleOutput
  needsBuild: () => checkForModifiedHeaders(),  

  /// etc...
})
```

### Specifying Actions

When a rule is triggered its action property is passed to the project's `exec` method, something
like this:

```js
// (pseudo code)
await this.exec(rule.action)
```

The `exec` functions accepts any of the following:

* A callback (sync or async) function that performs some action.
* A callback (sync or async) function that returns one of the following types.
* A string that will be parsed (using double quotes for args with spaces) into an array of 
  arguments and executed using the system shell
* An array of strings that will be flattened and executed using the system shell.
* An object with a `cmdargs` property that can be a string or array (as described above) and an
  optional `opts` property that specifies additional properties to be passed to Node's `spawn` function.

To specify multiple action steps for rule, use a callback and use `Project.exec()` to execute 
commands.

```js
this.rule({

  action: async () => {

    // Show info
    this.log(1, "Doing stuff...");

    // First command
    await this.exec(`ls -al "${this.buildDir}"`);

    // Second command
    await this.exec({
      cmdargs: [ "rm", "-rf", this.buildDir ],
      opts: { env: { /* whatever */ }},
    })
  }

});
```

Unlike the NodeJS functions that expect separate `cmd` and `args` parameters, `mk.js` expects a `cmdargs` 
array where `cmd` is taken from `cmdargs[0]` and `args` from `cmdargs[1...]`.


### Rule Merging

If a target matches multiple rules, the rules are merged

* `deps` are combined into a single array with the action rule's dependencies first
* `action` an error is thrown if more than one rule has an action
* `name` taken from the action rule
* `mkdir` any rule with `mkdir` set to true causes the directory to be created
* `subject` taken from the action rule
* `needsBuild` called on all matching rules



### Summary of Rule Properties

Rules support the following properties:

* `name` - the name of the rule (supported on file and named rules)
* `output` - marks the rule as a file rule and specifies the file it generates
* `deps` - an array of file or named rules to make before this one.  For file rules, if all the 
  dependencies are older than the output file, the rule's action is skipped.
* `action` - the action to invoke for this rule
* `subject` - the name of the file to display when running a file action
* `condition` - a callback to determine if the rule is applicable.  If defined and evaluates to 
  `false` the rule is ignored.
* `mkdir` - for file rules, if true creates the output file's directory if doesn't already exist.
* `needsBuild` - called for files that wouldn't normally need to be built as an extra check to trigger the build.  


## Libraries

A library is a simple mechanism to import rule and variable definitions from 
another file.  

A library is imported using the `use()` function:

```js
export default async function()
{
    // Load library
    await this.use("someLibrary");
}
```

This will look for a file `someLibrary.js` in the following locations:

1. the libPath as specified in mkopts (or via the command line)
2. the users home directory: `~/.mk.js/`
3. the built in tools directory (mk.js install location `./tools`)

(Note this is an async operation and should be awaited)

To import a local library, use a relative path and include the `.js` file 
extension.  These paths will be resolved against the current project directory
or the base directory of the current library being imported. (ie: nested
`use()` calls resolve against the current directory of the file being 
imported).

```js
export default async function()
{
    // Load library
    await this.use("./tools/mylib.js");
}
```


Implementing a library is the same as a regular `mk.js` file and should
export a default function that is passed the project object:

```js
export default async function()
{
    this.set({ /* ... */ });
    this.rule({ /* ... */ });
    etc...
}
```

Libraries can be used for shared variable declartions and rules and are often
used to define entire tool chains.  eg: `mk.js` includes built-in toolchains
for `msvc` and `gcc`.


## Sub-Projects

Sub-project provide an easy way to use other `mk.js` make scripts from a parent
script.  To load a sub-project, use the `loadSubProject()` method:

```js
let mySubProject = await this.loadSubProject("my-sub-project")
```

`loadSubProject` looks for a `mk.js` file in the specified directory (relative
to the parent project directory, loads it into a new `Project` object and
returns the loaded project.

Once loaded, the parent project can build targets on the sub-project.  Often
this will be done in the action of a rule.

```js
this.rule({
    name: "clean-sub-projects",
    action: async () => await mySubProject.buildTarget("clean");
})
```

All loaded projects are also available via the `subProjects` property which
is a dictionary of project name to project instance.

```js
// Build all sub-projects
this.rule({
    name: "build-sub-projects",
    action: async () => {
        for (let sp of Object.values(this.subProjects))
        {
            await sp.buildTarget("build");
        }
    }
})
```

The `loadSubProject` method also accepts a `mkopts` parameter
that can be used to pass variables and other settings to the sub-project

```js
// Load a sub-project and set variables 'config' and 'platform'
await this.loadSubProject("sub-project", {
    set: {
        config: "release",
        platform: "x64",
    }
});
```

## Built-in Variables

The `Project` object include several build in variables:

* `projectFile` - the full path of the loaded `mk.js` file
* `projectName` - defaults to the name of the directory the project was loaded from
* `projectDir` - the full path of the directory the project was loaded from
* `subProjects` - a map of project name to project object of all loaded sub-projects
* `ruleTarget` - the target of the current rule
* `ruleDeps` - the dependencies of the current rule
* `ruleFirstDep` - the first dependency of the current ule
* `ruleUniqueDeps` - the dependencies of the current rule with duplicates removed
* `ruleStem` - the matching stem (aka: `%`) of an inferred rule

