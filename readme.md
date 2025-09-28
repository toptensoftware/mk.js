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
        message: "$(greeting) $(subject)",
    });

    // File rule to create a file if it doesn't exist
    // (or if any of its input dependencies are newer)
    this.rule({
        output: "$(outputFile)",
        action: "echo $(message) > $(outputFile)",
    });

    // Named rule "build"
    this.rule({
        name: "build",
        deps: [ "$(outputFile)" ],
    });

    // Named rule "clean"
    this.rule({
        name: "clean",
        action: "rm $(outputFile)"
    });
}
```

Some notes about the above:

* Variables are declared using the `set()` function so they
  are available for string expansion.
* File rules have an `output` property and optionally a `name`
* Named rules have a `name` property and no `output` property
* Rules can have file and named rule dependencies (aka prerequisites) 
  that are specified by the `deps` property.
* Rules have an optional `action` properties that specified things
  to be done when the rule is invoked (eg: running commands)

To run the script, from the command line run `mk` with
no arguments.  Since no other targets are specified, mk.js
will look for a rule named "build" and run it:

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

To run the "clean" rule, then the "build" rule:

```
~/Projects/mk.js/sample (main)$ mk clean build
----- sample (./) -----
  creating: test.txt

~/Projects/mk.js/sample (main)$
```

