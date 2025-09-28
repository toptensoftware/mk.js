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
        greeting: "Hello World",
    });

    // File rule create a file if it doesn't exist
    this.rule({
        output: "$(outputFile)",
        action: "echo $(greeting) > $(outputFile)",
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

To run the script, from the command line just type `mk`

