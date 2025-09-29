# mk.js - JavaScript Make Tool

## Introduction

mk.js is a build system similar to `make` but with the power of JavaScript.

## Features

* Powerful variable system for flexible scripts
* Explicit and inferred rules
* File target and named target rules (without .PHONY directives)
* Built-in support for sub-projects
* Built-in tool chains for `msvc` and `gcc` C, C++ and assembly builds
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
  when the rule is invoked (eg: running commands)

To run the script, from the command line run `mk` with
no arguments - mk.js will look for a rule named "build" and run it:

```
~/Projects/mk.js/sample (main)$ mk
----- sample (./) -----
  creating: test.txt

~/Projects/mk.js/sample (main)$ cat test.txt
Hello World
```

To run the "clean" rule, pass it as an argument.  

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
* Variables - settings that customizes the build process
* Rules - how to build files and perform actions
* Libraries - re-usable variables and rules
* SubProjects - composing large projects from smaller ones

## Projects

The mk.js `Project` class declares a set of variables, rules and
sub-projects that comprise a build system.

When the root `mk.js` project script is loaded, the default exported
function is called, and passed the `Project` object as `this`.

```js
export default async function()
{
    // `this` is a reference to the `Project` instance
}
```

You can programmatically load a project:

```js
import { Project } from "mk.js";

let project = await Project.load("mk.js", { /* options */ })
```

Or, manually create one:

```js
import { Project } from "mk.js";

let project = new Project();
```

A project has a set of options (referred to as `mkopts`) that
roughly map to command line arguments.  These can be passed to
`Project.load()` and are accessable via the project's `mkopts` property

```js
mkopts = {
    dir: null,      // project directory (defaults to mk.js directory)
    set: {},        // a set of variables for this project
    globals: {},    // a set of variables for this project and all sub-projects
    rebuild: false, // forces targets to build regardless of timestamps
    libPath: [],    // path to search for libraries
    dryrun: false,  // don't actually run executable tasks
    verbosity: 1,   // output verbosity
    vars: false,    // dump variables once project has been loaded
}
```

## Variables

### Variable Basics

Variables are properties of the `Project` instance and should be set 
using the `set` method:

```js
// Set a single property
this.set("apples", "red");
assert.equal(this.apples, "red")

// Set multiple properties:
this.set({
  pears: "green",
  bananas: "yellow",
});
assert.equal(this.pears, "green")
assert.equal(this.bananas, "yellow")
```

Variables can also be set using the `default` method which works
the same as set, except if a variable is already defined, it's ignored

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

### Dynamic Variables

Variables can be declared dynamically by using a lambda function:

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

Variables can be any JavaScript type, but note that callback lambdas
in arrays and objects are not recursively called.

To dynamically generate the content of the array do this:

```js
// You probably do want this :)
this.set({
  apples: "red",
  colors: () => [ "yellow", this.apples ],
});

assert.deepEqual(this.colors, [ "yellow", "red" ])
```

This will result in an array with a callback

```js
// You probably don't want this :(
this.set({
  apples: "red",
  colors: [ "yellow", () => this.apples ],
});

// This will fail
assert.deepEqual(this.colors, [ "yellow", "red" ])
```

This will result in an array with a value, but the value 
won't update if the `apples` variable is changed:

```js
// You probably don't want this :(
this.set({
  apples: "red",
  colors: [ "yellow", this.apples ],
});

// This will pass
assert.deepEqual(this.colors, [ "yellow", "red" ])

// This will fail
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

## Rules

Rules declare how a file is built, or other actions called named rules.

Rules are declared using the Project's `rule()` function:

### Named Rules

Named rules have a `name` but no `output` property:

Named rules don't have dependency time stamp checks but do invoke
any defined dependencies (which can be file or named rules) and the 
rule's own actions.

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

A file rule has an `output` property that declares the file that the
rule will produce.  File rules are only executed if the output file 
doesn't exist, or if it's older than all the input file dependencies.

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

### Inferred File Rules

File rules can be inferred based on a pattern, using the `%` character
to represent any sequence of characters in a file name:

```js
this.rule({
  output: `%.obj`,
  deps: `%.c`,
  action: () => `gcc -o ${this.ruleOutput} -c ${this.ruleFirstDep}`,
});
```

Inferred rules are only used if a non-inferred rule with an action
is not defined.

If multiple inferred rules match a file, an error is generated.

### Rule Properties

Rules can have the following properties:

* `name` - the name of the rule (supported on file and named rules)
* `output` - marks the rule as a file rule and specifies the file it generates
* `deps` - an array of file or named rules to make before this one.  For file rules, if all the dependencies are older than the output file, the rule's action is skipped.
* `action` - the action to invoke for this rule
* `subject` - the name of the file to display when running a file action
* `condition` - a callback to determine if the rule is applicable.  If defined and evaluated to `false` the rule is ignored.
* `mkdir` - for file rules, if true creates the output file's directory if doesn't already exist.
* `needsBuild` - called for files that wouldn't normally need to be built as
an extra check to trigger the build.  Can be used to check for modified C/C++ header files as an extra trigger for invoking the action.


## Built-in Variables

The `Project` object include several build in variables:

`projectFile` - the full path of the loaded `mk.js` file
`projectName` - defaults to the name of the directory the project was loaded from
`projectDir` - the full path of the directory the project was loaded from
`subProjects` - a map of project name to project object of all loaded sub-projects
`ruleTarget` - the target of the current rule
`ruleDeps` - the dependencies of the current rule
`ruleFirstDep` - the first dependency of the current ule
`ruleUniqueDeps` - the dependencies of the current rule with duplicates removed
`ruleStem` - the matching stem (aka: `%`) of an inferred rule

